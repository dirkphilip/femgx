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
 * mutation handles; use {@link root.ViewportVisibility.setPartOccurrence} for live
 * changes.
 * @category Advanced runtime and WebGPU platform
 */
export interface RuntimePartOccurrence {
  /** Stable identity of this expanded placed-part occurrence. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** Reusable part definition referenced by this occurrence. */
  readonly partId: PartId;
  /** Expanded assembly occurrence that directly owns this part occurrence. */
  readonly occurrenceId: AssemblyOccurrenceId;
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
 * transforms. `partOccurrenceIds` contains only the direct placed parts in this
 * occurrence; child occurrences are listed in `childIds`.
 * @category Advanced runtime and WebGPU platform
 */
export interface RuntimeOccurrence {
  /** Stable identity of this expanded placement of an assembly definition. */
  readonly occurrenceId: AssemblyOccurrenceId;
  /** Reusable assembly definition expanded at this occurrence. */
  readonly assemblyId: AssemblyId;
  /** Parent occurrence, or `undefined` for the expanded root. */
  readonly parentId: AssemblyOccurrenceId | undefined;
  /** Direct child assembly occurrences in deterministic hierarchy order. */
  readonly childIds: readonly AssemblyOccurrenceId[];
  /** Stable placed-part ids directly contained by this occurrence. */
  readonly partOccurrenceIds: readonly PartOccurrenceId[];
  /** Visibility contributed by this occurrence's assembly-definition layer. */
  readonly visible: boolean;
  /** Effective visibility after ancestor and occurrence layers combine. */
  readonly effectiveVisible: boolean;
}

/**
 * Public scene-runtime queries expressed only in stable handles.
 *
 * This is a defensive inspection facade over a compiled scene, not a renderer
 * control surface. Collections and transforms are snapshots, runtime slots and
 * GPU records are hidden, and live mutations belong to {@link root.Viewport}.
 * `viewport.runtime` is the current facade; reacquire it after scene
 * replacement. Use {@link createSceneRuntime} only when a standalone CPU
 * snapshot is the intended workflow.
 * @category Advanced runtime and WebGPU platform
 */
export interface SceneRuntime {
  /** Assembly definition selected as the scene root. */
  readonly rootAssemblyId: AssemblyId;
  /** Number of expanded assembly occurrences, including the root. */
  readonly occurrenceCount: number;
  /** Number of expanded placed-part occurrences. */
  readonly partOccurrenceCount: number;
  /** Number of part occurrences currently effective-visible for rendering. */
  readonly visibleCount: number;
  /** Returns a fresh snapshot of every stable placed-part id in runtime order. */
  getPartOccurrenceIds(): readonly PartOccurrenceId[];
  /** Returns a fresh snapshot of every stable assembly-occurrence id in runtime order. */
  getOccurrenceIds(): readonly AssemblyOccurrenceId[];
  /** Materializes query records for all placed parts. */
  getPartOccurrences(): readonly RuntimePartOccurrence[];
  /** Materializes query records for all expanded assembly occurrences. */
  getOccurrences(): readonly RuntimeOccurrence[];
  /** Returns one placed-part record, or `undefined` for an unknown id. */
  getPartOccurrence(partOccurrenceId: PartOccurrenceId): RuntimePartOccurrence | undefined;
  /** Returns one assembly-occurrence record, or `undefined` for an unknown id. */
  getOccurrence(occurrenceId: AssemblyOccurrenceId): RuntimeOccurrence | undefined;
  /** Resolves a placed-part id to its reusable part id. */
  getPartId(partOccurrenceId: PartOccurrenceId): PartId | undefined;
  /** Returns a defensive copy of a placed part's world transform, or `undefined` for an unknown id. */
  getTransform(partOccurrenceId: PartOccurrenceId): Mat4 | undefined;
  /** Reports effective visibility for one placed part. */
  isPartOccurrenceVisible(partOccurrenceId: PartOccurrenceId): boolean;
  /**
   * Returns currently visible placed-part ids in deterministic depth-first runtime order.
   * This is runtime order, not the renderer's private part-batched draw order.
   */
  getVisiblePartOccurrenceIds(): readonly PartOccurrenceId[];
}

class PublicSceneRuntime implements SceneRuntime {
  private readonly partOccurrenceIds: readonly PartOccurrenceId[];
  private readonly occurrenceIds: readonly AssemblyOccurrenceId[];

  constructor(private readonly packed: PackedSceneRuntime) {
    this.partOccurrenceIds = Array.from({ length: packed.instanceCount }, (_, slot) =>
      invariantValue(packed.getInstanceId(slot), `instance id at ${slot}`),
    );
    this.occurrenceIds = Array.from({ length: packed.nodeCount }, (_, slot) =>
      invariantValue(packed.getNodeId(slot), `node id at ${slot}`),
    );
  }

  get rootAssemblyId(): AssemblyId {
    return this.packed.rootAssemblyId;
  }
  get occurrenceCount(): number {
    return this.packed.nodeCount;
  }
  get partOccurrenceCount(): number {
    return this.packed.instanceCount;
  }
  get visibleCount(): number {
    return this.packed.visibleCount;
  }
  getPartOccurrenceIds(): readonly PartOccurrenceId[] {
    return [...this.partOccurrenceIds];
  }
  getOccurrenceIds(): readonly AssemblyOccurrenceId[] {
    return [...this.occurrenceIds];
  }
  getPartOccurrences(): readonly RuntimePartOccurrence[] {
    return this.partOccurrenceIds.map((partOccurrenceId) =>
      invariantValue(
        this.getPartOccurrence(partOccurrenceId),
        `part occurrence ${partOccurrenceId}`,
      ),
    );
  }
  getOccurrences(): readonly RuntimeOccurrence[] {
    return this.occurrenceIds.map((occurrenceId) =>
      invariantValue(this.getOccurrence(occurrenceId), `occurrence ${occurrenceId}`),
    );
  }
  getPartOccurrence(partOccurrenceId: PartOccurrenceId): RuntimePartOccurrence | undefined {
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
      occurrenceId,
      visible: this.packed.instanceVisible[slot] === 1,
      partVisible: this.packed.instancePartVisible[slot] === 1,
      overrideVisible: this.packed.instanceOverrideVisible[slot] === 1,
      transform,
    };
  }
  getOccurrence(occurrenceId: AssemblyOccurrenceId): RuntimeOccurrence | undefined {
    const node = this.packed.getNodeSlot(occurrenceId);
    if (node === undefined) return undefined;
    const assemblyId = invariantValue(
      this.packed.nodeAssemblyIds[node],
      `assembly id at node ${node}`,
    );
    const parent = invariantValue(this.packed.nodeParents[node], `parent at node ${node}`);
    const childIds: AssemblyOccurrenceId[] = [];
    let child = invariantValue(this.packed.nodeFirstChild[node], `first child at node ${node}`);
    while (child !== -1) {
      childIds.push(invariantValue(this.packed.getNodeId(child), `node id at ${child}`));
      child = invariantValue(this.packed.nodeNextSibling[child], `next sibling at node ${child}`);
    }
    const partOccurrenceIds: PartOccurrenceId[] = [];
    const start = invariantValue(
      this.packed.nodeInstanceStart[node],
      `instance start at node ${node}`,
    );
    const end = invariantValue(this.packed.nodeInstanceEnd[node], `instance end at node ${node}`);
    for (let slot = start; slot < end; slot++) {
      if (this.packed.instanceOwningNode[slot] !== node) continue;
      partOccurrenceIds.push(
        invariantValue(this.packed.getInstanceId(slot), `instance id at ${slot}`),
      );
    }
    return {
      occurrenceId,
      assemblyId,
      parentId:
        parent === -1
          ? undefined
          : invariantValue(this.packed.getNodeId(parent), `node id at ${parent}`),
      childIds,
      partOccurrenceIds,
      visible: this.packed.nodeVisible[node] === 1,
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
  getVisiblePartOccurrenceIds(): readonly PartOccurrenceId[] {
    return Array.from(this.packed.getDrawList(), (slot) =>
      invariantValue(this.packed.getInstanceId(slot), `instance id at draw slot ${slot}`),
    );
  }
}

/** Adapts packed runtime storage to the stable public runtime boundary. */
export function createPublicSceneRuntime(packed: PackedSceneRuntime): SceneRuntime {
  return new PublicSceneRuntime(packed);
}

/**
 * Compiles a scene into a stable-handle runtime for package consumers.
 *
 * The result is immutable CPU-side inspection state and does not request
 * WebGPU. The canonical viewport creates and owns its live runtime internally;
 * call this function for pre-render inspection or host-side queries that need
 * no canvas.
 * @example Inspect placed parts before creating a viewport.
 * ```ts
 * import { createSceneRuntime } from "femgx/runtime";
 *
 * const runtime = createSceneRuntime(scene);
 * for (const occurrence of runtime.getPartOccurrences()) {
 *   console.log(occurrence.partOccurrenceId, occurrence.partId, occurrence.transform);
 * }
 * ```
 * @category Advanced runtime and WebGPU platform
 */
export function createSceneRuntime(scene: Scene): SceneRuntime {
  return createPublicSceneRuntime(createPackedSceneRuntime(scene));
}
