import type { Mat4 } from "../math/mat4";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyNodeId, InstanceId } from "../scene/types";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "./runtime";
import { invariantValue } from "./invariants";

/**
 * A stable, query-only description of one placed part.
 * @category Advanced runtime and WebGPU platform
 */
export interface RuntimeInstance {
  readonly instanceId: InstanceId;
  readonly partId: PartId;
  readonly nodeId: AssemblyNodeId;
  readonly visible: boolean;
  readonly partVisible: boolean;
  readonly overrideVisible: boolean;
  readonly transform: Mat4;
}

/**
 * A stable, query-only description of one expanded assembly occurrence.
 * @category Advanced runtime and WebGPU platform
 */
export interface RuntimeNode {
  readonly nodeId: AssemblyNodeId;
  readonly assemblyId: AssemblyId;
  readonly parentId: AssemblyNodeId | undefined;
  readonly childIds: readonly AssemblyNodeId[];
  readonly instanceIds: readonly InstanceId[];
  readonly visible: boolean;
  readonly effectiveVisible: boolean;
}

/**
 * Public scene-runtime queries expressed only in stable handles.
 * @category Advanced runtime and WebGPU platform
 */
export interface SceneRuntime {
  readonly rootAssemblyId: AssemblyId;
  readonly nodeCount: number;
  readonly instanceCount: number;
  readonly visibleCount: number;
  /** Returns every stable placed-part id in runtime order. */
  getInstanceIds(): readonly InstanceId[];
  /** Returns every stable assembly-occurrence id in runtime order. */
  getNodeIds(): readonly AssemblyNodeId[];
  /** Materializes query records for all placed parts. */
  getInstances(): readonly RuntimeInstance[];
  /** Materializes query records for all expanded assembly occurrences. */
  getNodes(): readonly RuntimeNode[];
  /** Returns one placed-part record, or `undefined` for an unknown id. */
  getInstance(instanceId: InstanceId): RuntimeInstance | undefined;
  /** Returns one assembly-occurrence record, or `undefined` for an unknown id. */
  getNode(nodeId: AssemblyNodeId): RuntimeNode | undefined;
  /** Resolves a placed-part id to its reusable part id. */
  getPartId(instanceId: InstanceId): PartId | undefined;
  /** Returns a placed part's world transform, or `undefined` for an unknown id. */
  getTransform(instanceId: InstanceId): Mat4 | undefined;
  /** Reports effective visibility for one placed part. */
  isInstanceVisible(instanceId: InstanceId): boolean;
  /** Returns the currently visible placed-part ids in draw order. */
  getDrawList(): readonly InstanceId[];
}

class PublicSceneRuntime implements SceneRuntime {
  private readonly instanceIds: readonly InstanceId[];
  private readonly nodeIds: readonly AssemblyNodeId[];

  constructor(private readonly packed: PackedSceneRuntime) {
    this.instanceIds = Array.from({ length: packed.instanceCount }, (_, slot) =>
      invariantValue(packed.getInstanceId(slot), `instance id at ${slot}`),
    );
    this.nodeIds = Array.from({ length: packed.nodeCount }, (_, slot) =>
      invariantValue(packed.getNodeId(slot), `node id at ${slot}`),
    );
  }

  get rootAssemblyId(): AssemblyId {
    return this.packed.rootAssemblyId;
  }
  get nodeCount(): number {
    return this.packed.nodeCount;
  }
  get instanceCount(): number {
    return this.packed.instanceCount;
  }
  get visibleCount(): number {
    return this.packed.visibleCount;
  }
  getInstanceIds(): readonly InstanceId[] {
    return this.instanceIds;
  }
  getNodeIds(): readonly AssemblyNodeId[] {
    return this.nodeIds;
  }
  getInstances(): readonly RuntimeInstance[] {
    return this.instanceIds.map((instanceId) =>
      invariantValue(this.getInstance(instanceId), `instance ${instanceId}`),
    );
  }
  getNodes(): readonly RuntimeNode[] {
    return this.nodeIds.map((nodeId) => invariantValue(this.getNode(nodeId), `node ${nodeId}`));
  }
  getInstance(instanceId: InstanceId): RuntimeInstance | undefined {
    const slot = this.packed.getInstanceSlot(instanceId);
    if (slot === undefined) return undefined;
    const partId = invariantValue(this.packed.instancePartIds[slot], `part id at instance ${slot}`);
    const owningNode = invariantValue(
      this.packed.instanceOwningNode[slot],
      `owning node at instance ${slot}`,
    );
    const nodeId = invariantValue(this.packed.getNodeId(owningNode), `node id at ${owningNode}`);
    const transform = invariantValue(
      this.packed.getTransform(slot),
      `transform at instance ${slot}`,
    );
    return {
      instanceId,
      partId,
      nodeId,
      visible: this.packed.instanceVisible[slot] === 1,
      partVisible: this.packed.instancePartVisible[slot] === 1,
      overrideVisible: this.packed.instanceOverrideVisible[slot] === 1,
      transform,
    };
  }
  getNode(nodeId: AssemblyNodeId): RuntimeNode | undefined {
    const node = this.packed.getNodeSlot(nodeId);
    if (node === undefined) return undefined;
    const assemblyId = invariantValue(
      this.packed.nodeAssemblyIds[node],
      `assembly id at node ${node}`,
    );
    const parent = invariantValue(this.packed.nodeParents[node], `parent at node ${node}`);
    const childIds: AssemblyNodeId[] = [];
    let child = invariantValue(this.packed.nodeFirstChild[node], `first child at node ${node}`);
    while (child !== -1) {
      childIds.push(invariantValue(this.packed.getNodeId(child), `node id at ${child}`));
      child = invariantValue(this.packed.nodeNextSibling[child], `next sibling at node ${child}`);
    }
    const instanceIds: InstanceId[] = [];
    const start = invariantValue(
      this.packed.nodeInstanceStart[node],
      `instance start at node ${node}`,
    );
    const end = invariantValue(this.packed.nodeInstanceEnd[node], `instance end at node ${node}`);
    for (let slot = start; slot < end; slot++) {
      instanceIds.push(invariantValue(this.packed.getInstanceId(slot), `instance id at ${slot}`));
    }
    return {
      nodeId,
      assemblyId,
      parentId:
        parent === -1
          ? undefined
          : invariantValue(this.packed.getNodeId(parent), `node id at ${parent}`),
      childIds,
      instanceIds,
      visible: this.packed.nodeVisible[node] === 1,
      effectiveVisible: this.packed.nodeEffectiveVisible[node] === 1,
    };
  }
  getPartId(instanceId: InstanceId): PartId | undefined {
    const slot = this.packed.getInstanceSlot(instanceId);
    return slot === undefined
      ? undefined
      : invariantValue(this.packed.instancePartIds[slot], `part id at instance ${slot}`);
  }
  getTransform(instanceId: InstanceId): Mat4 | undefined {
    const slot = this.packed.getInstanceSlot(instanceId);
    return slot === undefined
      ? undefined
      : invariantValue(this.packed.getTransform(slot), `transform at instance ${slot}`);
  }
  isInstanceVisible(instanceId: InstanceId): boolean {
    const slot = this.packed.getInstanceSlot(instanceId);
    return slot !== undefined && this.packed.isInstanceVisible(slot);
  }
  getDrawList(): readonly InstanceId[] {
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
 * @category Advanced runtime and WebGPU platform
 */
export function createSceneRuntime(scene: Scene): SceneRuntime {
  return createPublicSceneRuntime(createPackedSceneRuntime(scene));
}
