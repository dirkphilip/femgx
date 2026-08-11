import type { Mat4 } from "../math/mat4";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyNodeId, InstanceId } from "../scene/types";
import { compileSceneState, type RuntimeState } from "./compile";
import { setInstanceTransform, setNodeTransform, type TransformDelta } from "./transforms";
import {
  getDrawList as computeDrawList,
  setAssemblyNodeVisible,
  setAssemblyVisible,
  setInstanceVisible,
  setPartVisible,
  type VisibilityDelta,
} from "./visibility";

/**
 * A packed CPU-side view of a scene for rendering: placement transforms,
 * parent relationships, visibility, part references, and stable instance
 * handles stored in typed arrays.
 *
 * Instance ids are stable slots over the full depth-first placement list and
 * never change when visibility changes. The typed arrays are read-only views
 * into the runtime: do not mutate them, or visibleCount desynchronizes.
 */
export interface PackedSceneRuntime {
  readonly rootAssemblyId: AssemblyId;
  /** Number of compiled assembly expansions. */
  readonly nodeCount: number;
  /** Number of part placements; each is a stable instance id in `[0, count)`. */
  readonly instanceCount: number;
  readonly nodeNodeIds: readonly AssemblyNodeId[];
  /** Number of currently visible instances. */
  readonly visibleCount: number;
  readonly nodeAssemblyIds: Uint32Array;
  /** Parent node id per node, `-1` for the root. */
  readonly nodeParents: Int32Array;
  /** First child node id per node, `-1` if none. */
  readonly nodeFirstChild: Int32Array;
  /** Next sibling node id per node, `-1` if none. */
  readonly nodeNextSibling: Int32Array;
  /** Subtree instance range `[start, end)` per node, contiguous depth-first. */
  readonly nodeInstanceStart: Uint32Array;
  readonly nodeInstanceEnd: Uint32Array;
  /** Authoring (explicit) visibility per node. */
  readonly nodeVisible: Uint8Array;
  /** Authoring visibility AND every ancestor node. */
  readonly nodeEffectiveVisible: Uint8Array;
  /** Local placement transform per node (16 floats); root is identity. */
  readonly nodeLocalTransforms: Float32Array;
  /** Column-major world transform per node (16 floats). */
  readonly nodeWorldTransforms: Float32Array;
  readonly instancePartIds: Uint32Array;
  /** Owning node id per instance. */
  readonly instanceOwningNode: Uint32Array;
  /** Authoring part visibility per instance. */
  readonly instancePartVisible: Uint8Array;
  /** Per-instance override; gates effective visibility. */
  readonly instanceOverrideVisible: Uint8Array;
  /** Effective visibility per instance (override AND part AND hierarchy). */
  readonly instanceVisible: Uint8Array;
  /** Local placement transform per instance (16 floats). */
  readonly instanceLocalTransforms: Float32Array;
  /** Column-major world transform per instance (16 floats). */
  readonly instanceWorldTransforms: Float32Array;
  /** Resolves an instance id to its part id. */
  getPartId(instanceId: number): PartId | undefined;
  /** Resolves a stable instance slot to its authoring placement handle. */
  getInstanceId(instanceId: number): InstanceId | undefined;
  /** Resolves an authoring placement handle to its packed slot. */
  getInstanceSlot(instanceId: InstanceId): number | undefined;
  /** Resolves a packed node slot to its stable occurrence handle. */
  getNodeId(nodeId: number): AssemblyNodeId | undefined;
  /** Resolves an assembly occurrence handle to its packed node slot. */
  getNodeSlot(nodeId: AssemblyNodeId): number | undefined;
  /** Returns the world transform of an instance as a matrix view. */
  getTransform(instanceId: number): Mat4 | undefined;
  /** Returns the local placement transform of a node as a matrix view. */
  getNodeTransform(nodeId: number): Mat4 | undefined;
  /** Returns the world transform of a node as a matrix view. */
  getNodeWorldTransform(nodeId: number): Mat4 | undefined;
  isInstanceVisible(instanceId: number): boolean;
  /** Returns visible instance ids in deterministic depth-first order. */
  getDrawList(): Uint32Array;
  setInstanceVisible(instanceId: number, visible: boolean): VisibilityDelta;
  setPartVisible(partId: PartId, visible: boolean): VisibilityDelta;
  /** Sets visibility for one expanded assembly occurrence. */
  setAssemblyNodeVisible(nodeId: number, visible: boolean): VisibilityDelta;
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): VisibilityDelta;
  /** Sets a part instance's local placement transform and recomputes its world. */
  setInstanceTransform(instanceId: number, transform: Mat4): TransformDelta;
  /** Sets an assembly expansion's local transform and recomputes its subtree. */
  setNodeTransform(nodeId: number, transform: Mat4): TransformDelta;
}

function matrixView(transforms: Float32Array, count: number, index: number): Mat4 | undefined {
  if (index < 0 || index >= count) {
    return undefined;
  }
  return transforms.subarray(index * 16, index * 16 + 16);
}

function runtimeArrays(state: RuntimeState) {
  return {
    rootAssemblyId: state.rootAssemblyId,
    nodeCount: state.nodeCount,
    nodeNodeIds: state.nodeNodeIds,
    instanceCount: state.instanceCount,
    nodeAssemblyIds: state.nodeAssemblyIds,
    nodeParents: state.nodeParents,
    nodeFirstChild: state.nodeFirstChild,
    nodeNextSibling: state.nodeNextSibling,
    nodeInstanceStart: state.nodeInstanceStart,
    nodeInstanceEnd: state.nodeInstanceEnd,
    nodeVisible: state.nodeVisible,
    nodeEffectiveVisible: state.nodeEffectiveVisible,
    nodeLocalTransforms: state.nodeLocalTransforms,
    nodeWorldTransforms: state.nodeWorldTransforms,
    instancePartIds: state.instancePartIds,
    instanceOwningNode: state.instanceOwningNode,
    instancePartVisible: state.instancePartVisible,
    instanceOverrideVisible: state.instanceOverrideVisible,
    instanceVisible: state.instanceVisible,
    instanceLocalTransforms: state.instanceLocalTransforms,
    instanceWorldTransforms: state.instanceWorldTransforms,
  };
}

interface RuntimeMaps {
  readonly instanceSlots: ReadonlyMap<InstanceId, number>;
  readonly nodeSlots: ReadonlyMap<AssemblyNodeId, number>;
}

function runtimeMaps(state: RuntimeState): RuntimeMaps {
  const instanceSlots = new Map<InstanceId, number>();
  for (let slot = 0; slot < state.instanceInstanceIds.length; slot++) {
    const instanceId = state.instanceInstanceIds[slot];
    if (instanceId !== undefined) instanceSlots.set(instanceId, slot);
  }
  const nodeSlots = new Map<AssemblyNodeId, number>();
  for (let node = 0; node < state.nodeNodeIds.length; node++) {
    const nodeId = state.nodeNodeIds[node];
    if (nodeId !== undefined) nodeSlots.set(nodeId, node);
  }
  return { instanceSlots, nodeSlots };
}

/** Compiles a scene into packed storage for the renderer and viewport internals. */
export function createPackedSceneRuntime(scene: Scene): PackedSceneRuntime {
  const state: RuntimeState = compileSceneState(scene);
  return createPackedRuntime(state, runtimeMaps(state));
}

function createPackedRuntime(state: RuntimeState, maps: RuntimeMaps): PackedSceneRuntime {
  return {
    ...runtimeArrays(state),
    get visibleCount(): number {
      return state.visibleCount;
    },
    getPartId(instanceId: number): PartId | undefined {
      return state.instancePartIds[instanceId];
    },
    getInstanceId(instanceId: number): InstanceId | undefined {
      return state.instanceInstanceIds[instanceId];
    },
    getInstanceSlot(instanceId: InstanceId): number | undefined {
      return maps.instanceSlots.get(instanceId);
    },
    getNodeId(nodeId: number): AssemblyNodeId | undefined {
      return state.nodeNodeIds[nodeId];
    },
    getNodeSlot(nodeId: AssemblyNodeId): number | undefined {
      return maps.nodeSlots.get(nodeId);
    },
    getTransform(instanceId: number): Mat4 | undefined {
      return matrixView(state.instanceWorldTransforms, state.instanceCount, instanceId);
    },
    getNodeTransform(nodeId: number): Mat4 | undefined {
      return matrixView(state.nodeLocalTransforms, state.nodeCount, nodeId);
    },
    getNodeWorldTransform(nodeId: number): Mat4 | undefined {
      return matrixView(state.nodeWorldTransforms, state.nodeCount, nodeId);
    },
    isInstanceVisible(instanceId: number): boolean {
      return (
        instanceId >= 0 &&
        instanceId < state.instanceCount &&
        state.instanceVisible[instanceId] === 1
      );
    },
    getDrawList(): Uint32Array {
      return computeDrawList(state);
    },
    setInstanceVisible(instanceId: number, visible: boolean): VisibilityDelta {
      return setInstanceVisible(state, instanceId, visible);
    },
    setPartVisible(partId: PartId, visible: boolean): VisibilityDelta {
      return setPartVisible(state, partId, visible);
    },
    setAssemblyNodeVisible(nodeId: number, visible: boolean): VisibilityDelta {
      return setAssemblyNodeVisible(state, nodeId, visible);
    },
    setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): VisibilityDelta {
      return setAssemblyVisible(state, assemblyId, visible);
    },
    setInstanceTransform(instanceId: number, transform: Mat4): TransformDelta {
      return setInstanceTransform(state, instanceId, transform);
    },
    setNodeTransform(nodeId: number, transform: Mat4): TransformDelta {
      return setNodeTransform(state, nodeId, transform);
    },
  };
}
