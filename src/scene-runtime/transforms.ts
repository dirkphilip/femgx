import { multiply, type Mat4 } from "../math/mat4";
import type { RuntimeState } from "./compile";
import { invariantValue } from "./invariants";

/** Result of a transform update: which instance slots were recomputed. */
export interface TransformDelta {
  /** Instance ids whose world transform was recomputed, in ascending order. */
  readonly changedInstanceIds: readonly number[];
  /** False when the target id is out of range. */
  readonly valid: boolean;
}

function noopDelta(): TransformDelta {
  return { changedInstanceIds: [], valid: true };
}

function invalidDelta(): TransformDelta {
  return { changedInstanceIds: [], valid: false };
}

function matricesEqual(a: Mat4, b: Float32Array): boolean {
  for (let i = 0; i < 16; i++) {
    if (
      invariantValue(a[i], `matrix component at ${i}`) !==
      invariantValue(b[i], `matrix component at ${i}`)
    ) {
      return false;
    }
  }
  return true;
}

function nodeWorldView(state: RuntimeState, nodeId: number): Float32Array {
  return state.nodeWorldTransforms.subarray(nodeId * 16, nodeId * 16 + 16);
}

function recomputeInstanceWorld(state: RuntimeState, instanceId: number): void {
  const owningNode = invariantValue(
    state.instanceOwningNode[instanceId],
    `owning node at instance ${instanceId}`,
  );
  const local = state.instanceLocalTransforms.subarray(instanceId * 16, instanceId * 16 + 16);
  const world = multiply(nodeWorldView(state, owningNode), local);
  state.instanceWorldTransforms.set(world, instanceId * 16);
}

function recomputeNodeWorld(state: RuntimeState, node: number): void {
  const parent = invariantValue(state.nodeParents[node], `parent at node ${node}`);
  const local = state.nodeLocalTransforms.subarray(node * 16, node * 16 + 16);
  if (parent === -1) {
    state.nodeWorldTransforms.set(local, node * 16);
    return;
  }
  const world = multiply(nodeWorldView(state, parent), local);
  state.nodeWorldTransforms.set(world, node * 16);
}

function recomputeNodeSubtree(state: RuntimeState, entryNode: number, changed: number[]): void {
  const stack = [entryNode];
  while (stack.length > 0) {
    const node = invariantValue(stack.pop(), "transform traversal stack entry");
    recomputeNodeWorld(state, node);
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
    recomputeInstanceWorld(state, instanceId);
    changed.push(instanceId);
  }
}

/**
 * Replaces the local placement transform of a part instance and recomputes its
 * world transform from the owning assembly. Only the affected slot is touched;
 * other instances of the same part and sibling branches are unchanged.
 */
export function setInstanceTransform(
  state: RuntimeState,
  instanceId: number,
  transform: Mat4,
): TransformDelta {
  if (instanceId < 0 || instanceId >= state.instanceCount) {
    return invalidDelta();
  }
  const local = state.instanceLocalTransforms.subarray(instanceId * 16, instanceId * 16 + 16);
  if (matricesEqual(transform, local)) {
    return noopDelta();
  }
  state.instanceLocalTransforms.set(transform, instanceId * 16);
  recomputeInstanceWorld(state, instanceId);
  return { changedInstanceIds: [instanceId], valid: true };
}

/**
 * Replaces the local placement transform of an assembly expansion and recomputes
 * world transforms for that subtree only. Unchanged sibling branches retain
 * their existing values; instance slots and draw ordering are untouched.
 */
export function setNodeTransform(
  state: RuntimeState,
  nodeId: number,
  transform: Mat4,
): TransformDelta {
  if (nodeId < 0 || nodeId >= state.nodeCount) {
    return invalidDelta();
  }
  const local = state.nodeLocalTransforms.subarray(nodeId * 16, nodeId * 16 + 16);
  if (matricesEqual(transform, local)) {
    return noopDelta();
  }
  state.nodeLocalTransforms.set(transform, nodeId * 16);
  const changed: number[] = [];
  recomputeNodeSubtree(state, nodeId, changed);
  return { changedInstanceIds: changed, valid: true };
}
