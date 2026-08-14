import type {
  Assembly,
  NamedAssembly,
  PartPlacement,
  Placement,
  SubAssemblyPlacement,
} from "./assembly";
import { MAX_PART_ID, validatePartId, type Part, type PartId } from "../geometry/part";
import type { AssemblyId } from "./types";

/**
 * The authoritative CPU-side scene: parts, assemblies, and their visibility.
 * Renderers sync deltas from this model; all updates are immutable.
 * @category Start here
 */
export interface Scene {
  readonly rootAssemblyId: AssemblyId;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly assemblies: ReadonlyMap<AssemblyId, Assembly>;
  readonly visiblePartIds: ReadonlySet<PartId>;
  readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
}

/** @category Scene and geometry */
export interface SceneBuilder {
  /** Selects the registered root assembly for the scene. */
  withRoot(rootAssemblyId: AssemblyId): SceneBuilder;
  /** Registers one reusable part definition. */
  addPart(part: Part): SceneBuilder;
  /** Registers one named assembly definition. */
  addAssembly(assembly: NamedAssembly): SceneBuilder;
  /** Hides a registered part from the scene. */
  hidePart(partId: PartId): SceneBuilder;
  /** Shows a registered part in the scene. */
  showPart(partId: PartId): SceneBuilder;
  /** Hides a registered assembly and its occurrences. */
  hideAssembly(assemblyId: AssemblyId): SceneBuilder;
  /** Shows a registered assembly and its occurrences. */
  showAssembly(assemblyId: AssemblyId): SceneBuilder;
  /** Validates and materializes the immutable scene. */
  build(): Scene;
}

interface SceneState {
  readonly rootAssemblyId?: AssemblyId;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly assemblies: ReadonlyMap<AssemblyId, Assembly>;
  readonly visiblePartIds: ReadonlySet<PartId>;
  readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
}

function createBuilder(state: SceneState): SceneBuilder {
  const update = (next: Partial<SceneState>): SceneBuilder => createBuilder({ ...state, ...next });
  return {
    withRoot(rootAssemblyId: AssemblyId): SceneBuilder {
      return update({ rootAssemblyId });
    },
    addPart(part: Part): SceneBuilder {
      if (state.parts.has(part.id)) {
        throw new Error(`Part ${part.id} is already registered`);
      }
      const parts = new Map(state.parts);
      parts.set(part.id, part);
      const visiblePartIds = new Set(state.visiblePartIds);
      visiblePartIds.add(part.id);
      return update({ parts, visiblePartIds });
    },
    addAssembly(assembly: NamedAssembly): SceneBuilder {
      if (state.assemblies.has(assembly.id)) {
        throw new Error(`Assembly ${assembly.id} is already registered`);
      }
      const assemblies = new Map(state.assemblies);
      assemblies.set(assembly.id, assembly);
      const visibleAssemblyIds = new Set(state.visibleAssemblyIds);
      visibleAssemblyIds.add(assembly.id);
      return update({ assemblies, visibleAssemblyIds });
    },
    hidePart(partId: PartId): SceneBuilder {
      const visiblePartIds = new Set(state.visiblePartIds);
      visiblePartIds.delete(partId);
      return update({ visiblePartIds });
    },
    showPart(partId: PartId): SceneBuilder {
      const visiblePartIds = new Set(state.visiblePartIds);
      visiblePartIds.add(partId);
      return update({ visiblePartIds });
    },
    hideAssembly(assemblyId: AssemblyId): SceneBuilder {
      const visibleAssemblyIds = new Set(state.visibleAssemblyIds);
      visibleAssemblyIds.delete(assemblyId);
      return update({ visibleAssemblyIds });
    },
    showAssembly(assemblyId: AssemblyId): SceneBuilder {
      const visibleAssemblyIds = new Set(state.visibleAssemblyIds);
      visibleAssemblyIds.add(assemblyId);
      return update({ visibleAssemblyIds });
    },
    build(): Scene {
      const { rootAssemblyId, parts, assemblies, visiblePartIds, visibleAssemblyIds } = state;
      if (rootAssemblyId === undefined) {
        throw new Error("Scene root assembly is not set");
      }
      const scene = { rootAssemblyId, parts, assemblies, visiblePartIds, visibleAssemblyIds };
      validateScene(scene);
      return scene;
    },
  };
}

/** Validates a complete scene before it enters runtime ownership. */
export function validateScene(scene: Scene): void {
  validateAssemblyId(scene.rootAssemblyId, "Scene root assembly");
  validatePartRegistry(scene.parts);
  validateAssemblyRegistry(scene.assemblies, scene.parts);
  if (!scene.assemblies.has(scene.rootAssemblyId)) {
    throw new Error(`Scene root assembly ${scene.rootAssemblyId} is not registered`);
  }
  validateVisibleParts(scene.visiblePartIds, scene.parts);
  validateVisibleAssemblies(scene.visibleAssemblyIds, scene.assemblies);
  validateAcyclic(scene.assemblies);
}

function validatePartRegistry(parts: ReadonlyMap<PartId, Part>): void {
  for (const [key, part] of parts) {
    validatePartId(key);
    if (part.id !== key) {
      throw new Error(`Part registry key ${key} does not match part id ${part.id}`);
    }
  }
}

function validateAssemblyRegistry(
  assemblies: ReadonlyMap<AssemblyId, Assembly>,
  parts: ReadonlyMap<PartId, Part>,
): void {
  for (const [key, assembly] of assemblies) {
    validateAssemblyId(key, "Assembly");
    if (assembly.id !== key) {
      throw new Error(`Assembly registry key ${key} does not match assembly id ${assembly.id}`);
    }
    const placementIds = new Set<string>();
    for (let index = 0; index < assembly.placements.length; index++) {
      const placement = assembly.placements[index];
      if (placement === undefined) {
        throw new TypeError(`Assembly ${assembly.id} placement ${index} is missing`);
      }
      const placementIdValue = (placement as { readonly placementId?: unknown }).placementId;
      const placementId = placementIdValue === undefined ? String(index) : placementIdValue;
      validatePlacementId(placementId, assembly.id, index);
      if (placementIds.has(placementId)) {
        throw new Error(`Assembly ${assembly.id} contains duplicate placement id ${placementId}`);
      }
      placementIds.add(placementId);
      validatePlacement(placement, parts, assemblies, assembly.id, index);
    }
  }
}

function validatePlacementId(
  id: unknown,
  ownerId: AssemblyId,
  index: number,
): asserts id is string {
  if (typeof id !== "string" || id.length === 0 || id.includes("/")) {
    throw new Error(
      `Assembly ${ownerId} placement ${index} id must be a non-empty string without '/'`,
    );
  }
}

function validatePlacement(
  placement: Placement,
  parts: ReadonlyMap<PartId, Part>,
  assemblies: ReadonlyMap<AssemblyId, Assembly>,
  ownerId: AssemblyId,
  index: number,
): void {
  const kind = (placement as { readonly kind?: unknown }).kind;
  switch (kind) {
    case "part": {
      const partPlacement = placement as PartPlacement;
      validatePartId(partPlacement.partId);
      if (!parts.has(partPlacement.partId)) {
        throw new Error(
          `Assembly ${ownerId} placement ${index} references missing part ${partPlacement.partId}`,
        );
      }
      validateTransform(partPlacement.transform, ownerId, index);
      return;
    }
    case "assembly": {
      const assemblyPlacement = placement as SubAssemblyPlacement;
      validateAssemblyId(assemblyPlacement.assemblyId, `Assembly ${ownerId} placement ${index}`);
      if (!assemblies.has(assemblyPlacement.assemblyId)) {
        throw new Error(
          `Assembly ${ownerId} placement ${index} references missing assembly ${assemblyPlacement.assemblyId}`,
        );
      }
      validateTransform(assemblyPlacement.transform, ownerId, index);
      return;
    }
    default:
      throw new TypeError(
        `Assembly ${ownerId} placement ${index} has unsupported kind ${String(kind)}`,
      );
  }
}

function validateVisibleParts(
  visiblePartIds: ReadonlySet<PartId>,
  parts: ReadonlyMap<PartId, Part>,
): void {
  for (const partId of visiblePartIds) {
    validatePartId(partId);
    if (!parts.has(partId)) throw new Error(`Visible part ${partId} is not registered`);
  }
}

function validateVisibleAssemblies(
  visibleAssemblyIds: ReadonlySet<AssemblyId>,
  assemblies: ReadonlyMap<AssemblyId, Assembly>,
): void {
  for (const assemblyId of visibleAssemblyIds) {
    validateAssemblyId(assemblyId, "Visible assembly");
    if (!assemblies.has(assemblyId)) {
      throw new Error(`Visible assembly ${assemblyId} is not registered`);
    }
  }
}

function validateAssemblyId(id: AssemblyId, label: string): void {
  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_PART_ID) {
    throw new Error(`${label} id ${id} must be a finite integer in [0, ${MAX_PART_ID}]`);
  }
}

function validateTransform(transform: unknown, ownerId: AssemblyId, index: number): void {
  if (typeof transform !== "object" || transform === null) {
    throw new TypeError(
      `Assembly ${ownerId} placement ${index} transform must contain 16 components`,
    );
  }
  const candidate = transform as {
    readonly length?: unknown;
    readonly [component: number]: unknown;
  };
  if (candidate.length !== 16) {
    throw new RangeError(
      `Assembly ${ownerId} placement ${index} transform must contain exactly 16 components`,
    );
  }
  for (let component = 0; component < 16; component++) {
    const value = candidate[component];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(
        `Assembly ${ownerId} placement ${index} transform component ${component} must be finite`,
      );
    }
  }
}

function validateAcyclic(assemblies: ReadonlyMap<AssemblyId, Assembly>): void {
  const state = new Map<AssemblyId, "visiting" | "visited">();
  for (const id of assemblies.keys()) {
    if (state.has(id)) {
      continue;
    }
    const stack: Array<{ readonly id: AssemblyId; nextIndex: number }> = [{ id, nextIndex: 0 }];
    state.set(id, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) {
        continue;
      }
      const assembly = assemblies.get(frame.id);
      if (assembly === undefined || frame.nextIndex >= assembly.placements.length) {
        state.set(frame.id, "visited");
        stack.pop();
        continue;
      }
      const placement = assembly.placements[frame.nextIndex];
      frame.nextIndex += 1;
      if (placement?.kind !== "assembly") {
        continue;
      }
      const childState = state.get(placement.assemblyId);
      if (childState === "visiting") {
        throw new Error(`Assembly hierarchy contains a cycle through ${placement.assemblyId}`);
      }
      if (childState === "visited") {
        continue;
      }
      state.set(placement.assemblyId, "visiting");
      stack.push({ id: placement.assemblyId, nextIndex: 0 });
    }
  }
}

/**
 * Creates an empty scene builder.
 * @category Start here
 */
export function createScene(): SceneBuilder {
  return createBuilder({
    parts: new Map(),
    assemblies: new Map(),
    visiblePartIds: new Set(),
    visibleAssemblyIds: new Set(),
  });
}
