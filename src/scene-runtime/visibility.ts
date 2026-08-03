import type { Mat4 } from "../mat4";
import type { AssemblyId, PartId } from "../types";
import type { RuntimeState } from "./compile";

/** Result of a visibility update: the affected instance slots and counts. */
export interface VisibilityDelta {
  /** Instance ids whose effective visibility changed, in ascending order. */
  readonly changedInstanceIds: readonly number[];
  /** Number of visible instances before the update. */
  readonly previousVisibleCount: number;
  /** Number of visible instances after the update. */
  readonly visibleCount: number;
}

function makeDelta(
  state: RuntimeState,
  changed: readonly number[],
  previousVisibleCount: number,
): VisibilityDelta {
  return { changedInstanceIds: changed, previousVisibleCount, visibleCount: state.visibleCount };
}

function lowerBound(sorted: Uint32Array, key: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = low + ((high - low) >> 1);
    const value = sorted[mid];
    if (value === undefined) {
      break;
    }
    if (value < key) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function findGroup(
  sortedKeys: Uint32Array,
  offsets: Uint32Array,
  key: number,
): readonly [number, number] | undefined {
  const position = lowerBound(sortedKeys, key);
  if (position >= sortedKeys.length || sortedKeys[position] !== key) {
    return undefined;
  }
  const start = offsets[position];
  const end = offsets[position + 1];
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return [start, end];
}

function parentEffectiveVisible(state: RuntimeState, node: number): 0 | 1 {
  const parent = state.nodeParents[node];
  if (parent === -1) {
    return 1;
  }
  return parent !== undefined && state.nodeEffectiveVisible[parent] === 1 ? 1 : 0;
}

function recomputeInstance(state: RuntimeState, instanceId: number, changed: number[]): void {
  const owningNode = state.instanceOwningNode[instanceId];
  const hierarchyVisible = owningNode !== undefined && state.nodeEffectiveVisible[owningNode] === 1;
  const effective =
    state.instanceOverrideVisible[instanceId] === 1 &&
    state.instancePartVisible[instanceId] === 1 &&
    hierarchyVisible
      ? 1
      : 0;
  if (effective === state.instanceVisible[instanceId]) {
    return;
  }
  state.instanceVisible[instanceId] = effective;
  if (effective === 1) {
    state.visibleCount++;
  } else {
    state.visibleCount--;
  }
  changed.push(instanceId);
}

function recomputeSubtree(state: RuntimeState, entryNode: number, changed: number[]): void {
  const stack = [entryNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    const effective =
      state.nodeVisible[node] === 1 && parentEffectiveVisible(state, node) === 1 ? 1 : 0;
    if (effective === state.nodeEffectiveVisible[node]) {
      continue;
    }
    state.nodeEffectiveVisible[node] = effective;
    let child = state.nodeFirstChild[node] ?? -1;
    while (child !== -1) {
      stack.push(child);
      child = state.nodeNextSibling[child] ?? -1;
    }
  }
  const start = state.nodeInstanceStart[entryNode];
  const end = state.nodeInstanceEnd[entryNode];
  if (start === undefined || end === undefined) {
    return;
  }
  for (let instanceId = start; instanceId < end; instanceId++) {
    recomputeInstance(state, instanceId, changed);
  }
}

/** Toggles the effective visibility of a single instance slot. */
export function setInstanceVisible(
  state: RuntimeState,
  instanceId: number,
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  if (instanceId < 0 || instanceId >= state.instanceCount) {
    return makeDelta(state, [], previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  if (state.instanceOverrideVisible[instanceId] === flag) {
    return makeDelta(state, [], previousVisibleCount);
  }
  state.instanceOverrideVisible[instanceId] = flag;
  const changed: number[] = [];
  recomputeInstance(state, instanceId, changed);
  return makeDelta(state, changed, previousVisibleCount);
}

/**
 * Sets the authoring visibility of every instance of a part. Instances under a
 * hidden assembly stay hidden because hierarchy visibility gates the result.
 */
export function setPartVisible(
  state: RuntimeState,
  partId: PartId,
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  const range = findGroup(state.sortedPartIds, state.partInstanceOffset, partId);
  if (range === undefined) {
    return makeDelta(state, [], previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  const changed: number[] = [];
  for (let index = range[0]; index < range[1]; index++) {
    const instanceId = state.partInstanceList[index];
    if (instanceId === undefined) {
      continue;
    }
    if (state.instancePartVisible[instanceId] === flag) {
      continue;
    }
    state.instancePartVisible[instanceId] = flag;
    recomputeInstance(state, instanceId, changed);
  }
  return makeDelta(state, changed, previousVisibleCount);
}

/** Sets the authoring visibility of an assembly and everything beneath it. */
export function setAssemblyVisible(
  state: RuntimeState,
  assemblyId: AssemblyId,
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  const range = findGroup(state.sortedAssemblyIds, state.assemblyNodeOffset, assemblyId);
  if (range === undefined) {
    return makeDelta(state, [], previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  const changed: number[] = [];
  for (let index = range[0]; index < range[1]; index++) {
    const node = state.assemblyNodeList[index];
    if (node === undefined) {
      continue;
    }
    if (state.nodeVisible[node] === flag) {
      continue;
    }
    state.nodeVisible[node] = flag;
    recomputeSubtree(state, node, changed);
  }
  return makeDelta(state, changed, previousVisibleCount);
}

/** Replaces the world transform of a single instance slot. */
export function setInstanceTransform(
  state: RuntimeState,
  instanceId: number,
  transform: Mat4,
): boolean {
  if (instanceId < 0 || instanceId >= state.instanceCount) {
    return false;
  }
  state.instanceWorldTransforms.set(transform, instanceId * 16);
  return true;
}

/**
 * Returns the visible instance ids in deterministic depth-first order. The
 * result is a fresh array computed from the current visibility bits.
 */
export function getDrawList(state: RuntimeState): Uint32Array {
  const drawList = new Uint32Array(state.visibleCount);
  let write = 0;
  for (let instanceId = 0; instanceId < state.instanceCount; instanceId++) {
    if (state.instanceVisible[instanceId] === 1) {
      drawList[write] = instanceId;
      write++;
    }
  }
  return drawList;
}
