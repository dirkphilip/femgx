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
interface RuntimeMethods {
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
  /** Returns the precomputed instance slots belonging to a part. */
  getPartInstanceSlots(partId: PartId): ArrayLike<number>;
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

/** Packed scene storage plus internal behavior and stable identity indexes. */
export type PackedSceneRuntime = RuntimeState & RuntimeMethods;

function matrixView(transforms: Float32Array, count: number, index: number): Mat4 | undefined {
  if (index < 0 || index >= count) {
    return undefined;
  }
  return transforms.subarray(index * 16, index * 16 + 16);
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
  return Object.assign(state, createRuntimeMethods(state, maps));
}

function createRuntimeMethods(state: RuntimeState, maps: RuntimeMaps): RuntimeMethods {
  return {
    ...createRuntimeQueries(state, maps),
    ...createRuntimeMutations(state),
  };
}

function createRuntimeQueries(
  state: RuntimeState,
  maps: RuntimeMaps,
): Omit<
  RuntimeMethods,
  | "setInstanceVisible"
  | "setPartVisible"
  | "setAssemblyNodeVisible"
  | "setAssemblyVisible"
  | "setInstanceTransform"
  | "setNodeTransform"
> {
  return {
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
    getPartInstanceSlots(partId: PartId): ArrayLike<number> {
      const range = findPartRange(state, partId);
      return range === undefined
        ? new Uint32Array()
        : state.partInstanceList.subarray(range[0], range[1]);
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
  };
}

function createRuntimeMutations(
  state: RuntimeState,
): Pick<
  RuntimeMethods,
  | "setInstanceVisible"
  | "setPartVisible"
  | "setAssemblyNodeVisible"
  | "setAssemblyVisible"
  | "setInstanceTransform"
  | "setNodeTransform"
> {
  return {
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

function findPartRange(state: RuntimeState, partId: PartId): readonly [number, number] | undefined {
  let low = 0;
  let high = state.sortedPartIds.length;
  while (low < high) {
    const mid = low + ((high - low) >> 1);
    const value = state.sortedPartIds[mid];
    if (value === undefined) break;
    if (value < partId) low = mid + 1;
    else high = mid;
  }
  if (low >= state.sortedPartIds.length || state.sortedPartIds[low] !== partId) return undefined;
  const start = state.partInstanceOffset[low];
  const end = state.partInstanceOffset[low + 1];
  return start === undefined || end === undefined ? undefined : [start, end];
}
