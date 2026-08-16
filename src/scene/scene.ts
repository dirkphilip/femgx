import type { Assembly, NamedAssembly, Placement } from "./assembly";
import { MAX_PART_ID, validatePartId, type Part, type PartId } from "../geometry/part";
import type { AssemblyId } from "./types";

/**
 * The authoritative CPU-side scene: part and assembly registries plus
 * visibility state.
 *
 * A scene is the handoff from host-owned model authoring to
 * {@link createFemViewport}. Its maps contain reusable definitions; transforms
 * and occurrence identities live in {@link Placement} entries under the root
 * assembly. The renderer compiles this immutable snapshot into a derived
 * runtime, but never mutates or replaces the scene as the source of truth.
 * @category Start here
 */
export interface Scene {
  readonly rootAssemblyId: AssemblyId;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly assemblies: ReadonlyMap<AssemblyId, Assembly>;
  readonly visiblePartIds: ReadonlySet<PartId>;
  readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
}

/**
 * Mutable authoring transaction that snapshots one immutable {@link Scene}.
 *
 * Builder methods are intentionally chainable. `build()` copies the registries
 * and visibility sets, validates references and acyclicity, and returns a
 * snapshot safe to pass to {@link createFemViewport}; later builder calls do
 * not change an already-built scene.
 * @category Scene and geometry
 */
export interface SceneBuilder {
  /** Selects the registered root assembly that expands into the scene. */
  withRoot(rootAssemblyId: AssemblyId): SceneBuilder;
  /** Registers one reusable {@link Part} definition by its stable id. */
  addPart(part: Part): SceneBuilder;
  /** Registers one named assembly definition and validates its placements at build time. */
  addAssembly(assembly: NamedAssembly): SceneBuilder;
  /** Hides every occurrence of a registered part definition. */
  hidePart(partId: PartId): SceneBuilder;
  /** Shows every occurrence of a registered part definition. */
  showPart(partId: PartId): SceneBuilder;
  /** Hides a registered assembly definition and all of its expanded occurrences. */
  hideAssembly(assemblyId: AssemblyId): SceneBuilder;
  /** Shows a registered assembly definition and its expanded occurrences. */
  showAssembly(assemblyId: AssemblyId): SceneBuilder;
  /** Validates references and snapshots the accumulated state into an immutable scene. */
  build(): Scene;
}

interface SceneState {
  rootAssemblyId?: AssemblyId;
  readonly parts: Map<PartId, Part>;
  readonly assemblies: Map<AssemblyId, Assembly>;
  readonly visiblePartIds: Set<PartId>;
  readonly visibleAssemblyIds: Set<AssemblyId>;
}

function createBuilder(state: SceneState): SceneBuilder {
  const builder: SceneBuilder = {
    withRoot(rootAssemblyId: AssemblyId): SceneBuilder {
      state.rootAssemblyId = rootAssemblyId;
      return builder;
    },
    addPart(part: Part): SceneBuilder {
      if (state.parts.has(part.id)) {
        throw new Error(`Part ${part.id} is already registered`);
      }
      state.parts.set(part.id, part);
      state.visiblePartIds.add(part.id);
      return builder;
    },
    addAssembly(assembly: NamedAssembly): SceneBuilder {
      if (state.assemblies.has(assembly.id)) {
        throw new Error(`Assembly ${assembly.id} is already registered`);
      }
      state.assemblies.set(assembly.id, assembly);
      state.visibleAssemblyIds.add(assembly.id);
      return builder;
    },
    hidePart(partId: PartId): SceneBuilder {
      state.visiblePartIds.delete(partId);
      return builder;
    },
    showPart(partId: PartId): SceneBuilder {
      state.visiblePartIds.add(partId);
      return builder;
    },
    hideAssembly(assemblyId: AssemblyId): SceneBuilder {
      state.visibleAssemblyIds.delete(assemblyId);
      return builder;
    },
    showAssembly(assemblyId: AssemblyId): SceneBuilder {
      state.visibleAssemblyIds.add(assemblyId);
      return builder;
    },
    build(): Scene {
      const { rootAssemblyId } = state;
      if (rootAssemblyId === undefined) {
        throw new Error("Scene root assembly is not set");
      }
      const scene = {
        rootAssemblyId,
        parts: new Map(state.parts),
        assemblies: new Map(state.assemblies),
        visiblePartIds: new Set(state.visiblePartIds),
        visibleAssemblyIds: new Set(state.visibleAssemblyIds),
      };
      validateScene(scene);
      return scene;
    },
  };
  return builder;
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
  const candidate: unknown = placement;
  const kind =
    typeof candidate === "object" && candidate !== null && "kind" in candidate
      ? candidate.kind
      : undefined;
  switch (placement.kind) {
    case "part": {
      validatePartId(placement.partId);
      if (!parts.has(placement.partId)) {
        throw new Error(
          `Assembly ${ownerId} placement ${index} references missing part ${placement.partId}`,
        );
      }
      validateTransform(placement.transform, ownerId, index);
      return;
    }
    case "assembly": {
      validateAssemblyId(placement.assemblyId, `Assembly ${ownerId} placement ${index}`);
      if (!assemblies.has(placement.assemblyId)) {
        throw new Error(
          `Assembly ${ownerId} placement ${index} references missing assembly ${placement.assemblyId}`,
        );
      }
      validateTransform(placement.transform, ownerId, index);
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
  if (!(transform instanceof Float32Array)) {
    throw new TypeError(
      `Assembly ${ownerId} placement ${index} transform must contain 16 components`,
    );
  }
  if (transform.length !== 16) {
    throw new RangeError(
      `Assembly ${ownerId} placement ${index} transform must contain exactly 16 components`,
    );
  }
  for (let component = 0; component < 16; component++) {
    const value = transform[component];
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
 * Creates an empty mutable authoring transaction.
 *
 * The normal path is `addPart → addAssembly → withRoot → build`. A scene must
 * have a registered root; all placement references must resolve to registered
 * definitions and the assembly graph must be acyclic. `build()` returns an
 * isolated immutable snapshot, so it is also the boundary used to prepare a
 * candidate for {@link FemViewport.updateScene}.
 * @example Register one reusable part and its root assembly.
 * ```ts
 * import { createPart, createScene, identity } from "femgx";
 *
 * const part = createPart(1, {
 *   geometries: [{
 *     primitive: "points",
 *     positions: new Float32Array([0, 0, 0]),
 *     indices: new Uint32Array([0]),
 *   }],
 * });
 * const scene = createScene()
 *   .addPart(part)
 *   .addAssembly({
 *     id: 2,
 *     name: "root",
 *     placements: [{ kind: "part", partId: 1, transform: identity() }],
 *   })
 *   .withRoot(2)
 *   .build();
 * ```
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
