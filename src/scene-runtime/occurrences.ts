import type { Mat4 } from "../math/mat4";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "./runtime";
import { invariantValue } from "./invariants";

/**
 * A stable, query-only description of one placed part.
 *
 * `partOccurrenceId` identifies an expanded placement; `partId` identifies the
 * reusable definition it references. The transform is a defensive world-space
 * snapshot. Visibility fields describe effective runtime state and are not
 * mutation handles; use {@link root.ViewportVisibility.setPartOccurrenceVisible} for live
 * changes.
 * @category Advanced runtime and WebGPU platform
 */
export interface PartOccurrence {
  /** Stable identity of this expanded placed-part occurrence. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** Reusable part definition referenced by this occurrence. */
  readonly partId: PartId;
  /** Expanded assembly occurrence that directly owns this part occurrence. */
  readonly assemblyOccurrenceId: AssemblyOccurrenceId;
  /** Effective visibility after assembly-occurrence, part, and occurrence layers combine. */
  readonly visible: boolean;
  /** Visibility contributed by the part-definition layer. */
  readonly partVisible: boolean;
  /** Visibility contributed by the part-occurrence override layer. */
  readonly overrideVisible: boolean;
  /** Defensive world-space transform snapshot, in the scene's authored units. */
  readonly transform: Mat4;
}

/**
 * A stable, query-only description of one expanded assembly occurrence.
 *
 * An occurrence is distinct from an assembly definition: placing the same
 * `assemblyId` twice produces two occurrence ids with different parents and
 * transforms. Direct child and part occurrences are queried by local ordinal,
 * avoiding an id-array allocation for a large hierarchy node.
 * @category Advanced runtime and WebGPU platform
 */
export interface AssemblyOccurrence {
  /** Stable identity of this expanded placement of an assembly definition. */
  readonly assemblyOccurrenceId: AssemblyOccurrenceId;
  /** Reusable assembly definition expanded at this occurrence. */
  readonly assemblyId: AssemblyId;
  /** Parent occurrence, or `undefined` for the expanded root. */
  readonly parentAssemblyOccurrenceId: AssemblyOccurrenceId | undefined;
  /** Number of direct child assembly occurrences. */
  readonly childCount: number;
  /** Returns one direct child assembly occurrence in deterministic hierarchy order. */
  getChildId(ordinal: number): AssemblyOccurrenceId | undefined;
  /** Number of stable placed-part occurrences directly contained by this occurrence. */
  readonly partOccurrenceCount: number;
  /** Returns one direct placed-part occurrence in deterministic local order. */
  getPartOccurrenceId(ordinal: number): PartOccurrenceId | undefined;
  /** Visibility contributed by this occurrence's assembly-definition layer. */
  readonly visible: boolean;
  /** Effective visibility after ancestor and occurrence layers combine. */
  readonly effectiveVisible: boolean;
}

/**
 * Public placed-occurrence queries expressed only in stable handles.
 *
 * This is a defensive inspection facade over a compiled scene, not a renderer
 * control surface. Collections and transforms are snapshots, runtime slots and
 * GPU records are hidden, and live mutations belong to {@link root.Viewport}.
 * `viewport.occurrences` stays attached to the viewport across scene updates.
 * @category Advanced runtime and WebGPU platform
 */
export interface SceneOccurrences {
  /** Assembly definition selected as the scene root. */
  readonly rootAssemblyId: AssemblyId;
  /** Number of expanded assembly occurrences, including the root. */
  readonly assemblyOccurrenceCount: number;
  /** Number of expanded placed-part occurrences. */
  readonly partOccurrenceCount: number;
  /** Number of part occurrences currently effective-visible for rendering. */
  readonly visibleCount: number;
  /** Returns one stable placed-part id in deterministic occurrence order. */
  getPartOccurrenceId(ordinal: number): PartOccurrenceId | undefined;
  /** Returns one stable assembly-occurrence id in deterministic hierarchy order. */
  getAssemblyOccurrenceId(ordinal: number): AssemblyOccurrenceId | undefined;
  /** Streams fresh placed-part records without retaining a model-sized object array. */
  partOccurrences(): Iterable<PartOccurrence>;
  /** Streams fresh assembly-occurrence records without retaining a model-sized object array. */
  assemblyOccurrences(): Iterable<AssemblyOccurrence>;
  /** Returns one placed-part record, or `undefined` for an unknown id. */
  getPartOccurrence(partOccurrenceId: PartOccurrenceId): PartOccurrence | undefined;
  /** Returns one assembly-occurrence record, or `undefined` for an unknown id. */
  getAssemblyOccurrence(occurrenceId: AssemblyOccurrenceId): AssemblyOccurrence | undefined;
  /** Resolves a placed-part id to its reusable part id. */
  getPartId(partOccurrenceId: PartOccurrenceId): PartId | undefined;
  /** Returns a defensive copy of a placed part's world transform, or `undefined` for an unknown id. */
  getTransform(partOccurrenceId: PartOccurrenceId): Mat4 | undefined;
  /** Reports effective visibility for one placed part. */
  isPartOccurrenceVisible(partOccurrenceId: PartOccurrenceId): boolean;
  /** Streams currently visible placed-part ids in deterministic depth-first order. */
  visiblePartOccurrenceIds(): Iterable<PartOccurrenceId>;
}

class PublicSceneOccurrences implements SceneOccurrences {
  constructor(private readonly runtime: () => PackedSceneRuntime) {}

  private get packed(): PackedSceneRuntime {
    return this.runtime();
  }

  get rootAssemblyId(): AssemblyId {
    return this.packed.rootAssemblyId;
  }
  get assemblyOccurrenceCount(): number {
    return this.packed.activeNodeCount;
  }
  get partOccurrenceCount(): number {
    return this.packed.activeInstanceCount;
  }
  get visibleCount(): number {
    return this.packed.visibleCount;
  }
  getPartOccurrenceId(ordinal: number): PartOccurrenceId | undefined {
    return activePartOccurrenceIdAt(this.packed, ordinal);
  }
  getAssemblyOccurrenceId(ordinal: number): AssemblyOccurrenceId | undefined {
    return activeAssemblyOccurrenceIdAt(this.packed, ordinal);
  }
  *partOccurrences(): IterableIterator<PartOccurrence> {
    for (let slot = 0; slot < this.packed.instanceCount; slot += 1) {
      const partOccurrenceId = this.packed.getInstanceId(slot);
      if (partOccurrenceId === undefined) continue;
      yield invariantValue(
        this.getPartOccurrence(partOccurrenceId),
        `part occurrence ${partOccurrenceId}`,
      );
    }
  }
  *assemblyOccurrences(): IterableIterator<AssemblyOccurrence> {
    for (let ordinal = 0; ordinal < this.packed.nodeCount; ordinal += 1) {
      const occurrenceId = this.packed.getNodeId(ordinal);
      if (occurrenceId === undefined) continue;
      yield invariantValue(this.getAssemblyOccurrence(occurrenceId), `occurrence ${occurrenceId}`);
    }
  }
  getPartOccurrence(partOccurrenceId: PartOccurrenceId): PartOccurrence | undefined {
    const slot = this.packed.getInstanceSlot(partOccurrenceId);
    if (slot === undefined) return undefined;
    const partId = invariantValue(this.packed.instancePartIds[slot], `part id at instance ${slot}`);
    const owningNode = invariantValue(
      this.packed.instanceOwningNode[slot],
      `owning node at instance ${slot}`,
    );
    const occurrenceId = invariantValue(
      this.packed.getNodeId(owningNode),
      `occurrence id at ${owningNode}`,
    );
    const transform = invariantValue(
      this.getTransform(partOccurrenceId),
      `transform at instance ${slot}`,
    );
    return {
      partOccurrenceId,
      partId,
      assemblyOccurrenceId: occurrenceId,
      visible: this.packed.instanceVisible[slot] === 1,
      partVisible: this.packed.instancePartVisible[slot] === 1,
      overrideVisible: this.packed.instanceOverrideVisible[slot] === 1,
      transform,
    };
  }
  getAssemblyOccurrence(occurrenceId: AssemblyOccurrenceId): AssemblyOccurrence | undefined {
    const node = this.packed.getNodeSlot(occurrenceId);
    if (node === undefined) return undefined;
    const assemblyId = invariantValue(
      this.packed.nodeAssemblyIds[node],
      `assembly id at node ${node}`,
    );
    const parent = invariantValue(this.packed.nodeParents[node], `parent at node ${node}`);
    const childCount = countChildren(this.packed, node);
    const partOccurrenceCount = this.packed.getNodeInstanceSlots(node).length;
    return {
      assemblyOccurrenceId: occurrenceId,
      assemblyId,
      parentAssemblyOccurrenceId:
        parent === -1
          ? undefined
          : invariantValue(this.packed.getNodeId(parent), `node id at ${parent}`),
      childCount,
      getChildId: (ordinal) => childIdAt(this.packed, node, ordinal),
      partOccurrenceCount,
      getPartOccurrenceId: (ordinal) => directPartOccurrenceIdAt(this.packed, node, ordinal),
      visible: this.packed.nodeAssemblyVisible[node] === 1,
      effectiveVisible: this.packed.nodeEffectiveVisible[node] === 1,
    };
  }
  getPartId(partOccurrenceId: PartOccurrenceId): PartId | undefined {
    const slot = this.packed.getInstanceSlot(partOccurrenceId);
    return slot === undefined
      ? undefined
      : invariantValue(this.packed.instancePartIds[slot], `part id at instance ${slot}`);
  }
  getTransform(partOccurrenceId: PartOccurrenceId): Mat4 | undefined {
    const slot = this.packed.getInstanceSlot(partOccurrenceId);
    if (slot === undefined) return undefined;
    const transform = invariantValue(
      this.packed.getTransform(slot),
      `transform at instance ${slot}`,
    );
    return new Float32Array(transform);
  }
  isPartOccurrenceVisible(partOccurrenceId: PartOccurrenceId): boolean {
    const slot = this.packed.getInstanceSlot(partOccurrenceId);
    return slot !== undefined && this.packed.isInstanceVisible(slot);
  }
  *visiblePartOccurrenceIds(): IterableIterator<PartOccurrenceId> {
    for (const slot of this.packed.getDrawList()) {
      yield invariantValue(this.packed.getInstanceId(slot), `instance id at draw slot ${slot}`);
    }
  }
}

/** Adapts the current packed runtime to the stable public occurrence boundary. */
export function createSceneOccurrences(runtime: () => PackedSceneRuntime): SceneOccurrences {
  return new PublicSceneOccurrences(runtime);
}

/**
 * Compiles an immutable scene for repository-only CPU inspection.
 *
 * This is intentionally not a package entry point: browser hosts inspect the
 * live occurrences owned by their viewport instead.
 */
export function createSceneOccurrenceSnapshot(scene: Scene): SceneOccurrences {
  const runtime = createPackedSceneRuntime(scene);
  return createSceneOccurrences(() => runtime);
}

function childIdAt(
  runtime: PackedSceneRuntime,
  node: number,
  ordinal: number,
): AssemblyOccurrenceId | undefined {
  if (!Number.isInteger(ordinal) || ordinal < 0) return undefined;
  let child = invariantValue(runtime.nodeFirstChild[node], `first child at node ${node}`);
  for (let index = 0; child !== -1; index += 1) {
    if (index === ordinal) return runtime.getNodeId(child);
    child = invariantValue(runtime.nodeNextSibling[child], `next sibling at node ${child}`);
  }
  return undefined;
}

function countChildren(runtime: PackedSceneRuntime, node: number): number {
  let count = 0;
  let child = invariantValue(runtime.nodeFirstChild[node], `first child at node ${node}`);
  while (child !== -1) {
    count += 1;
    child = invariantValue(runtime.nodeNextSibling[child], `next sibling at node ${child}`);
  }
  return count;
}

function directPartOccurrenceIdAt(
  runtime: PackedSceneRuntime,
  node: number,
  ordinal: number,
): PartOccurrenceId | undefined {
  if (!Number.isInteger(ordinal) || ordinal < 0) return undefined;
  const slot = runtime.getNodeInstanceSlots(node)[ordinal];
  return slot === undefined ? undefined : runtime.getInstanceId(slot);
}

function activePartOccurrenceIdAt(
  runtime: PackedSceneRuntime,
  ordinal: number,
): PartOccurrenceId | undefined {
  if (!Number.isInteger(ordinal) || ordinal < 0) return undefined;
  let activeOrdinal = 0;
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const id = runtime.getInstanceId(slot);
    if (id === undefined) continue;
    if (activeOrdinal === ordinal) return id;
    activeOrdinal += 1;
  }
  return undefined;
}

function activeAssemblyOccurrenceIdAt(
  runtime: PackedSceneRuntime,
  ordinal: number,
): AssemblyOccurrenceId | undefined {
  if (!Number.isInteger(ordinal) || ordinal < 0) return undefined;
  let activeOrdinal = 0;
  for (let node = 0; node < runtime.nodeCount; node += 1) {
    const id = runtime.getNodeId(node);
    if (id === undefined) continue;
    if (activeOrdinal === ordinal) return id;
    activeOrdinal += 1;
  }
  return undefined;
}
