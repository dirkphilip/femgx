import type { Mat4 } from "../math/mat4";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyNodeId, InstanceId } from "../scene/types";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "./runtime";
import type { TransformDelta } from "./transforms";

/** A stable, query-only description of one placed part. */
export interface RuntimeInstance {
  readonly instanceId: InstanceId;
  readonly partId: PartId;
  readonly nodeId: AssemblyNodeId;
  readonly visible: boolean;
  readonly partVisible: boolean;
  readonly overrideVisible: boolean;
  readonly transform: Mat4;
}

/** A stable, query-only description of one expanded assembly occurrence. */
export interface RuntimeNode {
  readonly nodeId: AssemblyNodeId;
  readonly assemblyId: AssemblyId;
  readonly parentId: AssemblyNodeId | undefined;
  readonly childIds: readonly AssemblyNodeId[];
  readonly instanceIds: readonly InstanceId[];
  readonly visible: boolean;
  readonly effectiveVisible: boolean;
  readonly transform: Mat4;
  readonly worldTransform: Mat4;
}

/** Stable visibility result returned by the public runtime boundary. */
export interface RuntimeVisibilityDelta {
  readonly changedInstanceIds: readonly InstanceId[];
  readonly previousVisibleCount: number;
  readonly visibleCount: number;
}

/** Public scene-runtime queries and mutations expressed only in stable handles. */
export interface SceneRuntime {
  readonly rootAssemblyId: AssemblyId;
  readonly nodeCount: number;
  readonly instanceCount: number;
  readonly visibleCount: number;
  getInstanceIds(): readonly InstanceId[];
  getNodeIds(): readonly AssemblyNodeId[];
  getInstances(): readonly RuntimeInstance[];
  getNodes(): readonly RuntimeNode[];
  getInstance(instanceId: InstanceId): RuntimeInstance | undefined;
  getNode(nodeId: AssemblyNodeId): RuntimeNode | undefined;
  getPartId(instanceId: InstanceId): PartId | undefined;
  getTransform(instanceId: InstanceId): Mat4 | undefined;
  getNodeTransform(nodeId: AssemblyNodeId): Mat4 | undefined;
  getNodeWorldTransform(nodeId: AssemblyNodeId): Mat4 | undefined;
  isInstanceVisible(instanceId: InstanceId): boolean;
  getDrawList(): readonly InstanceId[];
  setInstanceVisible(instanceId: InstanceId, visible: boolean): RuntimeVisibilityDelta;
  setPartVisible(partId: PartId, visible: boolean): RuntimeVisibilityDelta;
  setAssemblyNodeVisible(nodeId: AssemblyNodeId, visible: boolean): RuntimeVisibilityDelta;
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): RuntimeVisibilityDelta;
  setInstanceTransform(instanceId: InstanceId, transform: Mat4): TransformDelta;
  setNodeTransform(nodeId: AssemblyNodeId, transform: Mat4): TransformDelta;
}

function mapChangedInstances(
  packed: PackedSceneRuntime,
  changedSlots: readonly number[],
): readonly InstanceId[] {
  return changedSlots.flatMap((slot) => {
    const instanceId = packed.getInstanceId(slot);
    return instanceId === undefined ? [] : [instanceId];
  });
}

function publicDelta(
  packed: PackedSceneRuntime,
  delta: {
    readonly changedInstanceIds: readonly number[];
    readonly previousVisibleCount: number;
    readonly visibleCount: number;
  },
): RuntimeVisibilityDelta {
  return {
    changedInstanceIds: mapChangedInstances(packed, delta.changedInstanceIds),
    previousVisibleCount: delta.previousVisibleCount,
    visibleCount: delta.visibleCount,
  };
}

class PublicSceneRuntime implements SceneRuntime {
  private readonly instanceIds: readonly InstanceId[];
  private readonly nodeIds: readonly AssemblyNodeId[];

  constructor(private readonly packed: PackedSceneRuntime) {
    this.instanceIds = Array.from({ length: packed.instanceCount }, (_, slot) =>
      packed.getInstanceId(slot),
    ).filter((id): id is InstanceId => id !== undefined);
    this.nodeIds = Array.from({ length: packed.nodeCount }, (_, slot) =>
      packed.getNodeId(slot),
    ).filter((id): id is AssemblyNodeId => id !== undefined);
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
    return this.instanceIds.flatMap((instanceId) => {
      const instance = this.getInstance(instanceId);
      return instance === undefined ? [] : [instance];
    });
  }
  getNodes(): readonly RuntimeNode[] {
    return this.nodeIds.flatMap((nodeId) => {
      const node = this.getNode(nodeId);
      return node === undefined ? [] : [node];
    });
  }
  getInstance(instanceId: InstanceId): RuntimeInstance | undefined {
    const slot = this.packed.getInstanceSlot(instanceId);
    if (slot === undefined) return undefined;
    const partId = this.packed.instancePartIds[slot];
    const owningNode = this.packed.instanceOwningNode[slot];
    if (owningNode === undefined) return undefined;
    const nodeId = this.packed.getNodeId(owningNode);
    const transform = this.packed.getTransform(slot);
    if (partId === undefined || nodeId === undefined || transform === undefined) return undefined;
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
    const assemblyId = this.packed.nodeAssemblyIds[node];
    const localTransform = this.packed.getNodeTransform(node);
    const worldTransform = this.packed.getNodeWorldTransform(node);
    if (assemblyId === undefined || localTransform === undefined || worldTransform === undefined) {
      return undefined;
    }
    const parent = this.packed.nodeParents[node];
    const childIds: AssemblyNodeId[] = [];
    let child = this.packed.nodeFirstChild[node] ?? -1;
    while (child !== -1) {
      const childId = this.packed.getNodeId(child);
      if (childId !== undefined) childIds.push(childId);
      child = this.packed.nodeNextSibling[child] ?? -1;
    }
    const instanceIds: InstanceId[] = [];
    const start = this.packed.nodeInstanceStart[node] ?? 0;
    const end = this.packed.nodeInstanceEnd[node] ?? start;
    for (let slot = start; slot < end; slot++) {
      const instanceId = this.packed.getInstanceId(slot);
      if (instanceId !== undefined) instanceIds.push(instanceId);
    }
    return {
      nodeId,
      assemblyId,
      parentId: parent === undefined || parent === -1 ? undefined : this.packed.getNodeId(parent),
      childIds,
      instanceIds,
      visible: this.packed.nodeVisible[node] === 1,
      effectiveVisible: this.packed.nodeEffectiveVisible[node] === 1,
      transform: localTransform,
      worldTransform,
    };
  }
  getPartId(instanceId: InstanceId): PartId | undefined {
    const slot = this.packed.getInstanceSlot(instanceId);
    return slot === undefined ? undefined : this.packed.instancePartIds[slot];
  }
  getTransform(instanceId: InstanceId): Mat4 | undefined {
    const slot = this.packed.getInstanceSlot(instanceId);
    return slot === undefined ? undefined : this.packed.getTransform(slot);
  }
  getNodeTransform(nodeId: AssemblyNodeId): Mat4 | undefined {
    const slot = this.packed.getNodeSlot(nodeId);
    return slot === undefined ? undefined : this.packed.getNodeTransform(slot);
  }
  getNodeWorldTransform(nodeId: AssemblyNodeId): Mat4 | undefined {
    const slot = this.packed.getNodeSlot(nodeId);
    return slot === undefined ? undefined : this.packed.getNodeWorldTransform(slot);
  }
  isInstanceVisible(instanceId: InstanceId): boolean {
    const slot = this.packed.getInstanceSlot(instanceId);
    return slot !== undefined && this.packed.isInstanceVisible(slot);
  }
  getDrawList(): readonly InstanceId[] {
    return Array.from(this.packed.getDrawList(), (slot) => this.packed.getInstanceId(slot)).filter(
      (id): id is InstanceId => id !== undefined,
    );
  }
  setInstanceVisible(instanceId: InstanceId, visible: boolean): RuntimeVisibilityDelta {
    const slot = this.packed.getInstanceSlot(instanceId);
    return publicDelta(
      this.packed,
      slot === undefined
        ? {
            changedInstanceIds: [],
            previousVisibleCount: this.packed.visibleCount,
            visibleCount: this.packed.visibleCount,
          }
        : this.packed.setInstanceVisible(slot, visible),
    );
  }
  setPartVisible(partId: PartId, visible: boolean): RuntimeVisibilityDelta {
    return publicDelta(this.packed, this.packed.setPartVisible(partId, visible));
  }
  setAssemblyNodeVisible(nodeId: AssemblyNodeId, visible: boolean): RuntimeVisibilityDelta {
    const node = this.packed.getNodeSlot(nodeId);
    return publicDelta(
      this.packed,
      node === undefined
        ? {
            changedInstanceIds: [],
            previousVisibleCount: this.packed.visibleCount,
            visibleCount: this.packed.visibleCount,
          }
        : this.packed.setAssemblyNodeVisible(node, visible),
    );
  }
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): RuntimeVisibilityDelta {
    return publicDelta(this.packed, this.packed.setAssemblyVisible(assemblyId, visible));
  }
  setInstanceTransform(instanceId: InstanceId, transform: Mat4): TransformDelta {
    const slot = this.packed.getInstanceSlot(instanceId);
    return slot === undefined
      ? { changedInstanceIds: [], valid: false }
      : this.packed.setInstanceTransform(slot, transform);
  }
  setNodeTransform(nodeId: AssemblyNodeId, transform: Mat4): TransformDelta {
    const node = this.packed.getNodeSlot(nodeId);
    return node === undefined
      ? { changedInstanceIds: [], valid: false }
      : this.packed.setNodeTransform(node, transform);
  }
}

/** Adapts packed runtime storage to the stable public runtime boundary. */
export function createPublicSceneRuntime(packed: PackedSceneRuntime): SceneRuntime {
  return new PublicSceneRuntime(packed);
}

/** Compiles a scene into a stable-handle runtime for package consumers. */
export function createSceneRuntime(scene: Scene): SceneRuntime {
  return createPublicSceneRuntime(createPackedSceneRuntime(scene));
}
