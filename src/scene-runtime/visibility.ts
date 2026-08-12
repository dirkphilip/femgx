import type { PartId } from "../geometry/part";
import type { AssemblyId } from "../scene/types";
import type { RuntimeState } from "./compile";
import { findGroupRange } from "./group-index";
import { invariantValue } from "./invariants";

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

function parentEffectiveVisible(state: RuntimeState, node: number): 0 | 1 {
  const parent = invariantValue(state.nodeParents[node], `parent at node ${node}`);
  if (parent === -1) {
    return 1;
  }
  return invariantValue(
    state.nodeEffectiveVisible[parent],
    `effective visibility at parent ${parent}`,
  ) === 1
    ? 1
    : 0;
}

function recomputeInstance(state: RuntimeState, instanceId: number, changed: number[]): void {
  const owningNode = invariantValue(
    state.instanceOwningNode[instanceId],
    `owning node at instance ${instanceId}`,
  );
  const hierarchyVisible =
    invariantValue(
      state.nodeEffectiveVisible[owningNode],
      `effective visibility at node ${owningNode}`,
    ) === 1;
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
    const node = invariantValue(stack.pop(), "visibility traversal stack entry");
    const effective =
      state.nodeVisible[node] === 1 && parentEffectiveVisible(state, node) === 1 ? 1 : 0;
    if (effective === state.nodeEffectiveVisible[node]) {
      continue;
    }
    state.nodeEffectiveVisible[node] = effective;
    let child = invariantValue(state.nodeFirstChild[node], `first child at node ${node}`);
    while (child !== -1) {
      stack.push(child);
      child = invariantValue(state.nodeNextSibling[child], `next sibling at node ${child}`);
    }
  }
  const start = invariantValue(
    state.nodeInstanceStart[entryNode],
    `instance start at node ${entryNode}`,
  );
  const end = invariantValue(state.nodeInstanceEnd[entryNode], `instance end at node ${entryNode}`);
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

/** Sets visibility for one expanded assembly occurrence and its subtree. */
export function setAssemblyNodeVisible(
  state: RuntimeState,
  nodeId: number,
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  if (nodeId < 0 || nodeId >= state.nodeCount) {
    return makeDelta(state, [], previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  if (state.nodeVisible[nodeId] === flag) {
    return makeDelta(state, [], previousVisibleCount);
  }
  state.nodeVisible[nodeId] = flag;
  const changed: number[] = [];
  recomputeSubtree(state, nodeId, changed);
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
  const range = findGroupRange(
    state.sortedPartIds,
    state.partInstanceOffset,
    state.partInstanceList.length,
    partId,
  );
  if (range === undefined) {
    return makeDelta(state, [], previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  const changed: number[] = [];
  for (let index = range[0]; index < range[1]; index++) {
    const instanceId = invariantValue(state.partInstanceList[index], `part instance at ${index}`);
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
  const range = findGroupRange(
    state.sortedAssemblyIds,
    state.assemblyNodeOffset,
    state.assemblyNodeList.length,
    assemblyId,
  );
  if (range === undefined) {
    return makeDelta(state, [], previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  const changed: number[] = [];
  for (let index = range[0]; index < range[1]; index++) {
    const node = invariantValue(state.assemblyNodeList[index], `assembly node at ${index}`);
    if (state.nodeVisible[node] === flag) {
      continue;
    }
    state.nodeVisible[node] = flag;
    recomputeSubtree(state, node, changed);
  }
  return makeDelta(state, changed, previousVisibleCount);
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
