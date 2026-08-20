import type { Mat4 } from "../math/mat4";
import { validateScene, type Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { compileSceneState, type RuntimeState } from "./compile";
import { findGroupRange } from "./group-index";
import { invariantValue } from "./invariants";
import {
  getDrawList as computeDrawList,
  setAssemblyNodeVisible,
  setAssemblyVisible,
  setInstanceVisible,
  setInstancesVisible,
  setPartVisible,
  type VisibilityDelta,
} from "./visibility";
import {
  insertSortedPartId,
  mergeSortedPartIds,
  removeSortedPartId,
  removeSortedPartIds,
} from "./sorted-part-ids";

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
  getInstanceId(instanceId: number): PartOccurrenceId | undefined;
  /** Resolves an authoring placement handle to its packed slot. */
  getInstanceSlot(instanceId: PartOccurrenceId): number | undefined;
  /** Resolves a packed node slot to its stable occurrence handle. */
  getNodeId(nodeId: number): AssemblyOccurrenceId | undefined;
  /** Resolves an assembly occurrence handle to its packed node slot. */
  getNodeSlot(nodeId: AssemblyOccurrenceId): number | undefined;
  /** Returns the world transform of an instance as a matrix view. */
  getTransform(instanceId: number): Mat4 | undefined;
  isInstanceActive(instanceId: number): boolean;
  isInstanceVisible(instanceId: number): boolean;
  /** Returns the precomputed instance slots belonging to a part. */
  getPartInstanceSlots(partId: PartId): Uint32Array;
  /** Returns direct placed-part slots owned by one expanded assembly node. */
  getNodeInstanceSlots(nodeId: number): readonly number[];
  /** Returns the expanded node slots belonging to an assembly definition. */
  getAssemblyNodeSlots(assemblyId: AssemblyId): Uint32Array;
  /** Returns visible instance ids in deterministic depth-first order. */
  getDrawList(): Uint32Array;
  setInstanceVisible(instanceId: number, visible: boolean): VisibilityDelta;
  setInstancesVisible(instanceIds: readonly number[], visible: boolean): VisibilityDelta;
  setPartVisible(partId: PartId, visible: boolean): VisibilityDelta;
  /** Sets visibility for one expanded assembly occurrence. */
  setAssemblyNodeVisible(nodeId: number, visible: boolean): VisibilityDelta;
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): VisibilityDelta;
  /** Adds one transaction's validated placements while publishing sorted membership once. */
  addInstances(inputs: readonly RuntimeInstanceInput[]): readonly number[];
  /** Removes one transaction's active placements while publishing sorted membership once. */
  removeInstances(instanceIds: readonly number[]): void;
  /** Replaces one active expanded placement in its existing stable slot. */
  updateInstance(instanceId: number, input: RuntimeInstanceInput): void;
}

export interface RuntimeInstanceInput {
  readonly instanceId: PartOccurrenceId;
  readonly partId: PartId;
  readonly owningNode: number;
  readonly partVisible: boolean;
  readonly overrideVisible: boolean;
  readonly worldTransform: Mat4;
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
  readonly instanceSlots: Map<PartOccurrenceId, number>;
  readonly nodeSlots: ReadonlyMap<AssemblyOccurrenceId, number>;
}

function runtimeMaps(state: RuntimeState): RuntimeMaps {
  const instanceSlots = new Map<PartOccurrenceId, number>();
  for (let slot = 0; slot < state.instanceCount; slot++) {
    const instanceId = state.instanceInstanceIds[slot];
    if (instanceId !== undefined) instanceSlots.set(instanceId, slot);
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
    ...createRuntimeMutations(state, maps),
  };
}

type RuntimeQueries = Omit<
  RuntimeMethods,
  | "setInstanceVisible"
  | "setInstancesVisible"
  | "setPartVisible"
  | "setAssemblyNodeVisible"
  | "setAssemblyVisible"
  | "addInstances"
  | "removeInstances"
  | "updateInstance"
>;

function createRuntimeQueries(state: RuntimeState, maps: RuntimeMaps): RuntimeQueries {
  return {
    getPartId(instanceId: number): PartId | undefined {
      return isActive(state, instanceId) ? state.instancePartIds[instanceId] : undefined;
    },
    getInstanceId(instanceId: number): PartOccurrenceId | undefined {
      return isActive(state, instanceId) ? state.instanceInstanceIds[instanceId] : undefined;
    },
    getInstanceSlot(instanceId: PartOccurrenceId): number | undefined {
      return maps.instanceSlots.get(instanceId);
    },
    getNodeId(nodeId: number): AssemblyOccurrenceId | undefined {
      return state.nodeNodeIds[nodeId];
    },
    getNodeSlot(nodeId: AssemblyOccurrenceId): number | undefined {
      return maps.nodeSlots.get(nodeId);
    },
    getPartInstanceSlots(partId: PartId): Uint32Array {
      return new Uint32Array(state.partInstanceGroups.slots(partId));
    },
    getNodeInstanceSlots(nodeId: number): readonly number[] {
      return state.nodeInstanceGroups.slots(nodeId);
    },
    getAssemblyNodeSlots(assemblyId: AssemblyId): Uint32Array {
      return groupSlots(
        state.sortedAssemblyIds,
        state.assemblyNodeOffset,
        state.assemblyNodeList,
        assemblyId,
      );
    },
    getTransform(instanceId: number): Mat4 | undefined {
      return isActive(state, instanceId)
        ? matrixView(state.instanceWorldTransforms, state.instanceCount, instanceId)
        : undefined;
    },
    isInstanceActive(instanceId: number): boolean {
      return isActive(state, instanceId);
    },
    isInstanceVisible(instanceId: number): boolean {
      return isActive(state, instanceId) && state.instanceVisible[instanceId] === 1;
    },
    getDrawList(): Uint32Array {
      return computeDrawList(state);
    },
  };
}

function groupSlots(
  sortedIds: Uint32Array,
  offsets: Uint32Array,
  slots: Uint32Array,
  id: number,
): Uint32Array {
  const range = findGroupRange(sortedIds, offsets, slots.length, id);
  return range === undefined ? new Uint32Array() : slots.subarray(range[0], range[1]);
}

function createRuntimeMutations(
  state: RuntimeState,
  maps: RuntimeMaps,
): Pick<
  RuntimeMethods,
  | "setInstanceVisible"
  | "setInstancesVisible"
  | "setPartVisible"
  | "setAssemblyNodeVisible"
  | "setAssemblyVisible"
  | "addInstances"
  | "removeInstances"
  | "updateInstance"
> {
  return {
    setInstanceVisible(instanceId: number, visible: boolean): VisibilityDelta {
      return setInstanceVisible(state, instanceId, visible);
    },
    setInstancesVisible(instanceIds: readonly number[], visible: boolean): VisibilityDelta {
      return setInstancesVisible(state, instanceIds, visible);
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
    addInstances(inputs: readonly RuntimeInstanceInput[]): readonly number[] {
      return addRuntimeInstances(state, maps, inputs);
    },
    removeInstances(instanceIds: readonly number[]): void {
      removeRuntimeInstances(state, maps, instanceIds);
    },
    updateInstance(instanceId: number, input: RuntimeInstanceInput): void {
      updateRuntimeInstance(state, instanceId, input);
    },
  };
}

function addRuntimeInstance(
  state: RuntimeState,
  maps: RuntimeMaps,
  input: RuntimeInstanceInput,
): number {
  if (maps.instanceSlots.has(input.instanceId)) {
    throw new Error(`Part occurrence ${input.instanceId} already exists`);
  }
  const slot = state.instanceFreeSlots.pop() ?? state.instanceCount++;
  reserveInstances(state, state.instanceCount);
  writeInstance(state, slot, input);
  maps.instanceSlots.set(input.instanceId, slot);
  state.partInstanceGroups.add(input.partId, slot);
  state.nodeInstanceGroups.add(input.owningNode, slot);
  state.activeInstanceCount += 1;
  if (state.instanceVisible[slot] === 1) state.visibleCount += 1;
  return slot;
}

function addRuntimeInstances(
  state: RuntimeState,
  maps: RuntimeMaps,
  inputs: readonly RuntimeInstanceInput[],
): readonly number[] {
  const slots = new Array<number>(inputs.length);
  const addedPartIds = new Set<PartId>();
  for (let index = 0; index < inputs.length; index += 1) {
    const input = invariantValue(inputs[index], `added instance at ${index}`);
    if (state.partInstanceGroups.slots(input.partId).length === 0) addedPartIds.add(input.partId);
    slots[index] = addRuntimeInstance(state, maps, input);
  }
  if (addedPartIds.size > 0) {
    state.sortedPartIds = mergeSortedPartIds(state.sortedPartIds, addedPartIds);
  }
  return slots;
}

function removeRuntimeInstance(state: RuntimeState, maps: RuntimeMaps, instanceId: number): void {
  if (!isActive(state, instanceId)) throw new Error(`Instance slot ${instanceId} is inactive`);
  const id = invariantValue(state.instanceInstanceIds[instanceId], `instance id at ${instanceId}`);
  const partId = invariantValue(state.instancePartIds[instanceId], `part at ${instanceId}`);
  const node = invariantValue(state.instanceOwningNode[instanceId], `node at ${instanceId}`);
  if (state.instanceVisible[instanceId] === 1) state.visibleCount -= 1;
  state.partInstanceGroups.remove(partId, instanceId);
  state.nodeInstanceGroups.remove(node, instanceId);
  maps.instanceSlots.delete(id);
  state.instanceActive[instanceId] = 0;
  state.instanceVisible[instanceId] = 0;
  state.instanceInstanceIds[instanceId] = "";
  state.instanceFreeSlots.push(instanceId);
  state.activeInstanceCount -= 1;
}

function removeRuntimeInstances(
  state: RuntimeState,
  maps: RuntimeMaps,
  instanceIds: readonly number[],
): void {
  const removedPartIds = new Set<PartId>();
  for (const instanceId of instanceIds) {
    if (!isActive(state, instanceId)) throw new Error(`Instance slot ${instanceId} is inactive`);
    const partId = invariantValue(state.instancePartIds[instanceId], `part at ${instanceId}`);
    removedPartIds.add(partId);
    removeRuntimeInstance(state, maps, instanceId);
  }
  const emptiedPartIds = new Set<PartId>();
  for (const partId of removedPartIds) {
    if (state.partInstanceGroups.slots(partId).length === 0) emptiedPartIds.add(partId);
  }
  if (emptiedPartIds.size > 0) {
    state.sortedPartIds = removeSortedPartIds(state.sortedPartIds, emptiedPartIds);
  }
}

function updateRuntimeInstance(
  state: RuntimeState,
  instanceId: number,
  input: RuntimeInstanceInput,
): void {
  if (!isActive(state, instanceId)) throw new Error(`Instance slot ${instanceId} is inactive`);
  if (state.instanceInstanceIds[instanceId] !== input.instanceId) {
    throw new Error("Cannot replace an instance identity");
  }
  const previousPart = invariantValue(state.instancePartIds[instanceId], "previous part");
  const previousNode = invariantValue(state.instanceOwningNode[instanceId], "previous node");
  const wasVisible = state.instanceVisible[instanceId] === 1;
  if (previousPart !== input.partId) {
    state.partInstanceGroups.remove(previousPart, instanceId);
    if (state.partInstanceGroups.slots(previousPart).length === 0) {
      state.sortedPartIds = removeSortedPartId(state.sortedPartIds, previousPart);
    }
    const newPart = state.partInstanceGroups.slots(input.partId).length === 0;
    state.partInstanceGroups.add(input.partId, instanceId);
    if (newPart) state.sortedPartIds = insertSortedPartId(state.sortedPartIds, input.partId);
  }
  if (previousNode !== input.owningNode) {
    state.nodeInstanceGroups.remove(previousNode, instanceId);
    state.nodeInstanceGroups.add(input.owningNode, instanceId);
  }
  writeInstance(state, instanceId, input);
  const visible = state.instanceVisible[instanceId] === 1;
  if (wasVisible !== visible) state.visibleCount += visible ? 1 : -1;
}

function isActive(state: RuntimeState, instanceId: number): boolean {
  return (
    instanceId >= 0 && instanceId < state.instanceCount && state.instanceActive[instanceId] === 1
  );
}

function writeInstance(state: RuntimeState, slot: number, input: RuntimeInstanceInput): void {
  state.instancePartIds[slot] = input.partId;
  state.instanceOwningNode[slot] = input.owningNode;
  state.instancePartVisible[slot] = input.partVisible ? 1 : 0;
  state.instanceOverrideVisible[slot] = input.overrideVisible ? 1 : 0;
  state.instanceVisible[slot] =
    input.partVisible && input.overrideVisible && state.nodeEffectiveVisible[input.owningNode] === 1
      ? 1
      : 0;
  state.instanceActive[slot] = 1;
  state.instanceWorldTransforms.set(input.worldTransform, slot * 16);
  state.instanceInstanceIds[slot] = input.instanceId;
}

function reserveInstances(state: RuntimeState, required: number): void {
  if (required <= state.instanceCapacity) return;
  let capacity = Math.max(1, state.instanceCapacity);
  while (capacity < required) capacity *= 2;
  state.instancePartIds = growUint32(state.instancePartIds, capacity);
  state.instanceOwningNode = growUint32(state.instanceOwningNode, capacity);
  state.instancePartVisible = growUint8(state.instancePartVisible, capacity);
  state.instanceOverrideVisible = growUint8(state.instanceOverrideVisible, capacity);
  state.instanceVisible = growUint8(state.instanceVisible, capacity);
  state.instanceActive = growUint8(state.instanceActive, capacity);
  state.instanceWorldTransforms = growFloat32(state.instanceWorldTransforms, capacity * 16);
  state.instanceInstanceIds.length = capacity;
  state.instanceCapacity = capacity;
}

function growUint8(values: Uint8Array, length: number): Uint8Array {
  const next = new Uint8Array(length);
  next.set(values);
  return next;
}

function growUint32(values: Uint32Array, length: number): Uint32Array {
  const next = new Uint32Array(length);
  next.set(values);
  return next;
}

function growFloat32(values: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length);
  next.set(values);
  return next;
}
