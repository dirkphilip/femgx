import type { PartId } from "../geometry/part";
import type { AssemblyId } from "../scene/types";
import type { RuntimeState } from "./compile";
import { invariantValue } from "./invariants";

/** Result of a visibility update, compacted to renderer-owned part batches. */
export interface VisibilityDelta {
  /** Part batches containing instances whose effective visibility changed. */
  readonly affectedPartIds: readonly PartId[];
  /** Number of visible instances before the update. */
  readonly previousVisibleCount: number;
  /** Number of visible instances after the update. */
  readonly visibleCount: number;
}

function makeDelta(
  state: RuntimeState,
  affected: ReadonlySet<PartId>,
  previousVisibleCount: number,
): VisibilityDelta {
  return {
    affectedPartIds: [...affected].sort((a, b) => a - b),
    previousVisibleCount,
    visibleCount: state.visibleCount,
  };
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

function recomputeInstance(state: RuntimeState, instanceId: number, affected: Set<PartId>): void {
  if (state.instanceActive[instanceId] !== 1) return;
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
  affected.add(invariantValue(state.instancePartIds[instanceId], `part at instance ${instanceId}`));
}

function recomputeSubtree(state: RuntimeState, entryNode: number, affected: Set<PartId>): void {
  const stack = [entryNode];
  while (stack.length > 0) {
    const node = invariantValue(stack.pop(), "visibility traversal stack entry");
    const effective =
      state.nodeAssemblyVisible[node] === 1 &&
      state.nodeOverrideVisible[node] === 1 &&
      parentEffectiveVisible(state, node) === 1
        ? 1
        : 0;
    if (effective === state.nodeEffectiveVisible[node]) {
      continue;
    }
    state.nodeEffectiveVisible[node] = effective;
    for (const instanceId of state.nodeInstanceGroups.slots(node)) {
      recomputeInstance(state, instanceId, affected);
    }
    let child = invariantValue(state.nodeFirstChild[node], `first child at node ${node}`);
    while (child !== -1) {
      stack.push(child);
      child = invariantValue(state.nodeNextSibling[child], `next sibling at node ${child}`);
    }
  }
}

/** Toggles the effective visibility of a single instance slot. */
export function setInstanceVisible(
  state: RuntimeState,
  instanceId: number,
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  if (
    instanceId < 0 ||
    instanceId >= state.instanceCount ||
    state.instanceActive[instanceId] !== 1
  ) {
    return makeDelta(state, new Set(), previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  if (state.instanceOverrideVisible[instanceId] === flag) {
    return makeDelta(state, new Set(), previousVisibleCount);
  }
  state.instanceOverrideVisible[instanceId] = flag;
  const affected = new Set<PartId>();
  recomputeInstance(state, instanceId, affected);
  return makeDelta(state, affected, previousVisibleCount);
}

/** Toggles occurrence visibility for already-resolved instance slots in one transition. */
export function setInstancesVisible(
  state: RuntimeState,
  instanceIds: readonly number[],
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  const flag = visible ? 1 : 0;
  const affected = new Set<PartId>();
  for (const instanceId of instanceIds) {
    if (
      instanceId < 0 ||
      instanceId >= state.instanceCount ||
      state.instanceActive[instanceId] !== 1
    )
      continue;
    if (state.instanceOverrideVisible[instanceId] === flag) continue;
    state.instanceOverrideVisible[instanceId] = flag;
    recomputeInstance(state, instanceId, affected);
  }
  return makeDelta(state, affected, previousVisibleCount);
}

/** Sets visibility for one expanded assembly occurrence and its subtree. */
export function setAssemblyNodeVisible(
  state: RuntimeState,
  nodeId: number,
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  if (nodeId < 0 || nodeId >= state.nodeCount || state.nodeActive[nodeId] !== 1) {
    return makeDelta(state, new Set(), previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  if (state.nodeOverrideVisible[nodeId] === flag) {
    return makeDelta(state, new Set(), previousVisibleCount);
  }
  state.nodeOverrideVisible[nodeId] = flag;
  const affected = new Set<PartId>();
  recomputeSubtree(state, nodeId, affected);
  return makeDelta(state, affected, previousVisibleCount);
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
  const slots = state.partInstanceGroups.slots(partId);
  if (slots.length === 0) {
    return makeDelta(state, new Set(), previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  let changed = false;
  let visibleCount = state.visibleCount;
  for (const instanceId of slots) {
    if (state.instancePartVisible[instanceId] === flag) {
      continue;
    }
    state.instancePartVisible[instanceId] = flag;
    const owningNode = invariantValue(state.instanceOwningNode[instanceId], "owning node");
    const effective =
      flag === 1 &&
      state.instanceOverrideVisible[instanceId] === 1 &&
      state.nodeEffectiveVisible[owningNode] === 1
        ? 1
        : 0;
    if (effective === state.instanceVisible[instanceId]) continue;
    state.instanceVisible[instanceId] = effective;
    visibleCount += effective === 1 ? 1 : -1;
    changed = true;
  }
  state.visibleCount = visibleCount;
  return {
    affectedPartIds: changed ? [partId] : [],
    previousVisibleCount,
    visibleCount,
  };
}

/** Sets the authoring visibility of an assembly and everything beneath it. */
export function setAssemblyVisible(
  state: RuntimeState,
  assemblyId: AssemblyId,
  visible: boolean,
): VisibilityDelta {
  const previousVisibleCount = state.visibleCount;
  const nodes = state.assemblyNodeGroups.slots(assemblyId);
  if (nodes.length === 0) {
    return makeDelta(state, new Set(), previousVisibleCount);
  }
  const flag = visible ? 1 : 0;
  const affected = new Set<PartId>();
  for (const node of nodes) {
    if (state.nodeAssemblyVisible[node] === flag) {
      continue;
    }
    state.nodeAssemblyVisible[node] = flag;
    recomputeSubtree(state, node, affected);
  }
  return makeDelta(state, affected, previousVisibleCount);
}

/**
 * Returns the visible instance ids in deterministic depth-first order. The
 * result is a fresh array computed from the current visibility bits.
 */
export function getDrawList(state: RuntimeState): Uint32Array {
  const drawList = new Uint32Array(state.visibleCount);
  let write = 0;
  for (let instanceId = 0; instanceId < state.instanceCount; instanceId++) {
    if (state.instanceActive[instanceId] === 1 && state.instanceVisible[instanceId] === 1) {
      drawList[write] = instanceId;
      write++;
    }
  }
  return drawList;
}
