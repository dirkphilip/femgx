import type { AssemblyDefinition, Placement } from "./assembly";
import { MAX_PART_ID, validatePartId, type Part, type PartId } from "../geometry/part";
import type { AssemblyId } from "./types";
import { cachePlacementIndex } from "./assembly-index";

/**
 * The authoritative CPU-side scene: part and assembly registries plus
 * visibility state.
 *
 * A scene is the handoff from host-owned model authoring to
 * {@link createViewport}. Its maps contain reusable definitions; transforms
 * and occurrence identities live in {@link Placement} entries under the root
 * assembly. The renderer compiles this immutable snapshot into a derived
 * runtime, but never mutates or replaces the scene as the source of truth.
 * @category Start here
 */
export interface Scene {
  /** Registered root assembly definition expanded into the scene. */
  readonly rootAssemblyId: AssemblyId;
  /** Immutable registry of reusable part definitions keyed by {@link Part.id}. */
  readonly parts: ReadonlyMap<PartId, Part>;
  /** Immutable registry of reusable assembly definitions keyed by assembly id. */
  readonly assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>;
  /**
   * Authored initial visibility for part definitions. Every part added through
   * {@link SceneBuilder.addPart} starts in this set; the set is a snapshot and
   * is not the live visibility state after a scene enters a {@link Viewport}.
   */
  readonly visiblePartIds: ReadonlySet<PartId>;
  /**
   * Authored initial visibility for assembly definitions. Every assembly added
   * through {@link SceneBuilder.addAssembly} starts in this set; use the
   * viewport visibility setters for live occurrence or definition changes.
   */
  readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
}

/**
 * Mutable authoring transaction that snapshots one immutable {@link Scene}.
 *
 * Builder methods are intentionally chainable. `build()` copies the registries
 * and visibility sets, validates references and acyclicity, and returns a
 * snapshot safe to pass to {@link createViewport}; later builder calls do
 * not change an already-built scene.
 * @category Scene and geometry
 */
export interface SceneBuilder {
  /** Selects the registered root assembly that expands into the scene. */
  setRootAssembly(rootAssemblyId: AssemblyId): SceneBuilder;
  /**
   * Registers one reusable {@link Part} definition by its stable id. Newly
   * registered parts are visible by default in the built scene.
   */
  addPart(part: Part): SceneBuilder;
  /**
   * Registers one named assembly definition and validates its placements at
   * build time. Newly registered assemblies are visible by default in the
   * built scene.
   */
  addAssembly(assembly: AssemblyDefinition): SceneBuilder;
  /** Hides every occurrence of a registered part definition. */
  /** Sets visibility for every occurrence of a registered part definition. */
  setPartVisible(partId: PartId, visible: boolean): SceneBuilder;
  /** Sets visibility for a registered assembly definition and all of its expanded occurrences. */
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): SceneBuilder;
  /** Validates references and snapshots the accumulated state into an immutable scene. */
  build(): Scene;
}

interface SceneState {
  rootAssemblyId?: AssemblyId;
  readonly parts: Map<PartId, Part>;
  readonly assemblies: Map<AssemblyId, AssemblyDefinition>;
  readonly visiblePartIds: Set<PartId>;
  readonly visibleAssemblyIds: Set<AssemblyId>;
}

function createBuilder(state: SceneState): SceneBuilder {
  const builder: SceneBuilder = {
    setRootAssembly(rootAssemblyId: AssemblyId): SceneBuilder {
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
    addAssembly(assembly: AssemblyDefinition): SceneBuilder {
      if (state.assemblies.has(assembly.id)) {
        throw new Error(`AssemblyDefinition ${assembly.id} is already registered`);
      }
      state.assemblies.set(assembly.id, assembly);
      state.visibleAssemblyIds.add(assembly.id);
      return builder;
    },
    setPartVisible(partId: PartId, visible: boolean): SceneBuilder {
      if (visible) state.visiblePartIds.add(partId);
      else state.visiblePartIds.delete(partId);
      return builder;
    },
    setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): SceneBuilder {
      if (visible) state.visibleAssemblyIds.add(assemblyId);
      else state.visibleAssemblyIds.delete(assemblyId);
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
  assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>,
  parts: ReadonlyMap<PartId, Part>,
): void {
  for (const [key, assembly] of assemblies) {
    validateAssemblyDefinition(key, assembly, parts, assemblies);
  }
}

/** Validates one changed reusable assembly definition at the authoring boundary. */
export function validateAssemblyDefinition(
  key: AssemblyId,
  assembly: AssemblyDefinition,
  parts: ReadonlyMap<PartId, Part>,
  assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>,
): void {
  validateAssemblyId(key, "AssemblyDefinition");
  if (assembly.id !== key) {
    throw new Error(
      `AssemblyDefinition registry key ${key} does not match assembly id ${assembly.id}`,
    );
  }
  const placementIds = new Map<string, number>();
  for (let index = 0; index < assembly.placements.length; index++) {
    const placement = assembly.placements[index];
    if (placement === undefined) {
      throw new TypeError(`AssemblyDefinition ${assembly.id} placement ${index} is missing`);
    }
    const placementIdValue = (placement as { readonly placementId?: unknown }).placementId;
    const placementId = placementIdValue === undefined ? String(index) : placementIdValue;
    validatePlacementId(placementId, assembly.id, index);
    if (placementIds.has(placementId)) {
      throw new Error(
        `AssemblyDefinition ${assembly.id} contains duplicate placement id ${placementId}`,
      );
    }
    placementIds.set(placementId, index);
    validatePlacement(placement, parts, assemblies, assembly.id, index);
  }
  cachePlacementIndex(assembly, placementIds);
}

function validatePlacementId(
  id: unknown,
  ownerId: AssemblyId,
  index: number,
): asserts id is string {
  if (typeof id !== "string" || id.length === 0 || id.includes("/")) {
    throw new Error(
      `AssemblyDefinition ${ownerId} placement ${index} id must be a non-empty string without '/'`,
    );
  }
}

function validatePlacement(
  placement: Placement,
  parts: ReadonlyMap<PartId, Part>,
  assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>,
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
          `AssemblyDefinition ${ownerId} placement ${index} references missing part ${placement.partId}`,
        );
      }
      validatePlacementTransform(placement.transform, ownerId, index);
      return;
    }
    case "assembly": {
      validateAssemblyId(placement.assemblyId, `AssemblyDefinition ${ownerId} placement ${index}`);
      if (!assemblies.has(placement.assemblyId)) {
        throw new Error(
          `AssemblyDefinition ${ownerId} placement ${index} references missing assembly ${placement.assemblyId}`,
        );
      }
      validatePlacementTransform(placement.transform, ownerId, index);
      return;
    }
    default:
      throw new TypeError(
        `AssemblyDefinition ${ownerId} placement ${index} has unsupported kind ${String(kind)}`,
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
  assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>,
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

/** Validates one changed placement transform at the scene ownership boundary. */
export function validatePlacementTransform(
  transform: unknown,
  ownerId: AssemblyId,
  index: number,
): void {
  if (!(transform instanceof Float32Array)) {
    throw new TypeError(
      `AssemblyDefinition ${ownerId} placement ${index} transform must contain 16 components`,
    );
  }
  if (transform.length !== 16) {
    throw new RangeError(
      `AssemblyDefinition ${ownerId} placement ${index} transform must contain exactly 16 components`,
    );
  }
  for (let component = 0; component < 16; component++) {
    const value = transform[component];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(
        `AssemblyDefinition ${ownerId} placement ${index} transform component ${component} must be finite`,
      );
    }
  }
}

function validateAcyclic(assemblies: ReadonlyMap<AssemblyId, AssemblyDefinition>): void {
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
        throw new Error(
          `AssemblyDefinition hierarchy contains a cycle through ${placement.assemblyId}`,
        );
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
 * The normal path is `addPart → addAssembly → setRootAssembly → build`. A scene must
 * have a registered root; all placement references must resolve to registered
 * definitions and the assembly graph must be acyclic. `build()` returns an
 * isolated immutable snapshot, so it is also the boundary used to prepare a
 * initial snapshot for {@link Viewport}; use `Viewport.updateScene` for live edits.
 * @example Register one reusable part and its root assembly.
 * ```ts
 * import { createPart, createSceneBuilder, identityMatrix } from "femgx";
 *
 * const part = createPart(1, {
 *   geometries: [{
 *     primitive: "points",
 *     positions: new Float32Array([0, 0, 0]),
 *     indices: new Uint32Array([0]),
 *   }],
 * });
 * const scene = createSceneBuilder()
 *   .addPart(part)
 *   .addAssembly({
 *     id: 2,
 *     name: "root",
 *     placements: [{ kind: "part", partId: 1, transform: identityMatrix() }],
 *   })
 *   .setRootAssembly(2)
 *   .build();
 * ```
 * @category Start here
 */
export function createSceneBuilder(): SceneBuilder {
  return createBuilder({
    parts: new Map(),
    assemblies: new Map(),
    visiblePartIds: new Set(),
    visibleAssemblyIds: new Set(),
  });
}
