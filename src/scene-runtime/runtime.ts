import type { Mat4 } from "../math/mat4";
import { validateScene, type Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, InstanceId } from "../scene/types";
import { compileSceneState, type RuntimeState } from "./compile";
import { findGroupRange } from "./group-index";
import { invariantValue } from "./invariants";
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
  getNodeId(nodeId: number): AssemblyOccurrenceId | undefined;
  /** Resolves an assembly occurrence handle to its packed node slot. */
  getNodeSlot(nodeId: AssemblyOccurrenceId): number | undefined;
  /** Returns the world transform of an instance as a matrix view. */
  getTransform(instanceId: number): Mat4 | undefined;
  isInstanceVisible(instanceId: number): boolean;
  /** Returns the precomputed instance slots belonging to a part. */
  getPartInstanceSlots(partId: PartId): Uint32Array;
  /** Returns visible instance ids in deterministic depth-first order. */
  getDrawList(): Uint32Array;
  setInstanceVisible(instanceId: number, visible: boolean): VisibilityDelta;
  setPartVisible(partId: PartId, visible: boolean): VisibilityDelta;
  /** Sets visibility for one expanded assembly occurrence. */
  setAssemblyNodeVisible(nodeId: number, visible: boolean): VisibilityDelta;
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): VisibilityDelta;
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
  readonly nodeSlots: ReadonlyMap<AssemblyOccurrenceId, number>;
}

function runtimeMaps(state: RuntimeState): RuntimeMaps {
  const instanceSlots = new Map<InstanceId, number>();
  for (let slot = 0; slot < state.instanceInstanceIds.length; slot++) {
    const instanceId = invariantValue(state.instanceInstanceIds[slot], `instance id at ${slot}`);
    instanceSlots.set(instanceId, slot);
  }
  const nodeSlots = new Map<AssemblyOccurrenceId, number>();
  for (let node = 0; node < state.nodeNodeIds.length; node++) {
    const nodeId = invariantValue(state.nodeNodeIds[node], `node id at ${node}`);
    nodeSlots.set(nodeId, node);
  }
  return { instanceSlots, nodeSlots };
}

/** Compiles a scene into packed storage for the renderer and viewport internals. */
export function createPackedSceneRuntime(scene: Scene): PackedSceneRuntime {
  validateScene(scene);
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
  "setInstanceVisible" | "setPartVisible" | "setAssemblyNodeVisible" | "setAssemblyVisible"
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
    getNodeId(nodeId: number): AssemblyOccurrenceId | undefined {
      return state.nodeNodeIds[nodeId];
    },
    getNodeSlot(nodeId: AssemblyOccurrenceId): number | undefined {
      return maps.nodeSlots.get(nodeId);
    },
    getPartInstanceSlots(partId: PartId): Uint32Array {
      const range = findGroupRange(
        state.sortedPartIds,
        state.partInstanceOffset,
        state.partInstanceList.length,
        partId,
      );
      return range === undefined
        ? new Uint32Array()
        : state.partInstanceList.subarray(range[0], range[1]);
    },
    getTransform(instanceId: number): Mat4 | undefined {
      return matrixView(state.instanceWorldTransforms, state.instanceCount, instanceId);
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
  "setInstanceVisible" | "setPartVisible" | "setAssemblyNodeVisible" | "setAssemblyVisible"
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
  };
}
