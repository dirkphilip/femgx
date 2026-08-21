import type { Mat4 } from "../math/mat4";
import type { AssemblyId, AssemblyOccurrenceId } from "../scene/types";
import type { RuntimeState } from "./compile";
import { invariantValue } from "./invariants";
import type { RuntimeJournalOwner } from "./runtime-journal";

/** Private input used while committing a prepared assembly-subtree expansion. */
export interface RuntimeAssemblyNodeInput {
  readonly nodeId: AssemblyOccurrenceId;
  readonly assemblyId: AssemblyId;
  readonly parent: number;
  readonly worldTransform: Mat4;
  readonly assemblyVisible: boolean;
}

/** Adds one assembly occurrence without repacking surviving node slots. */
export function addRuntimeAssemblyNode(
  state: RuntimeState,
  nodeSlots: Map<AssemblyOccurrenceId, number>,
  input: RuntimeAssemblyNodeInput,
  journal: RuntimeJournalOwner,
): number {
  if (nodeSlots.has(input.nodeId)) {
    throw new Error(`Assembly occurrence ${input.nodeId} already exists`);
  }
  if (input.parent !== -1 && !isNodeActive(state, input.parent)) {
    throw new Error(`Assembly parent node ${input.parent} is inactive`);
  }
  const node = journal.popNodeFreeSlot() ?? state.nodeCount++;
  reserveNodes(state, state.nodeCount);
  state.nodeAssemblyIds[node] = input.assemblyId;
  state.nodeWorldTransforms.set(input.worldTransform, node * 16);
  state.nodeParents[node] = input.parent;
  state.nodeFirstChild[node] = -1;
  state.nodeNextSibling[node] = -1;
  state.nodeAssemblyVisible[node] = input.assemblyVisible ? 1 : 0;
  state.nodeOverrideVisible[node] = 1;
  state.nodeEffectiveVisible[node] =
    input.assemblyVisible && (input.parent === -1 || state.nodeEffectiveVisible[input.parent] === 1)
      ? 1
      : 0;
  state.nodeActive[node] = 1;
  state.nodeNodeIds[node] = input.nodeId;
  state.nodePlacementOrder[node] = [];
  state.assemblyNodeGroups.add(input.assemblyId, node);
  nodeSlots.set(input.nodeId, node);
  state.activeNodeCount += 1;
  return node;
}

/** Releases nodes after their leaf slots were retired. */
export function removeRuntimeAssemblyNodes(
  state: RuntimeState,
  nodeSlots: Map<AssemblyOccurrenceId, number>,
  nodeIds: readonly number[],
  journal: RuntimeJournalOwner,
): void {
  for (const node of nodeIds) {
    if (!isNodeActive(state, node)) throw new Error(`Assembly node ${node} is inactive`);
    if (state.nodeInstanceGroups.slots(node).length > 0) {
      throw new Error(`Assembly node ${node} still owns part occurrences`);
    }
  }
  for (const node of nodeIds) {
    const id = invariantValue(state.nodeNodeIds[node], `node id at ${node}`);
    const assemblyId = invariantValue(state.nodeAssemblyIds[node], `assembly at ${node}`);
    state.assemblyNodeGroups.remove(assemblyId, node);
    nodeSlots.delete(id);
    state.nodeActive[node] = 0;
    state.nodeNodeIds[node] = "";
    state.nodeFirstChild[node] = -1;
    state.nodeNextSibling[node] = -1;
    state.nodeParents[node] = -1;
    state.nodeEffectiveVisible[node] = 0;
    state.nodePlacementOrder[node] = [];
    journal.pushNodeFreeSlot(node);
    state.activeNodeCount -= 1;
  }
}

/** Relinks one retained parent's direct assembly children in authored order. */
export function setRuntimeNodeChildren(
  state: RuntimeState,
  node: number,
  children: readonly number[],
): void {
  if (!isNodeActive(state, node)) throw new Error(`Assembly node ${node} is inactive`);
  let previous = -1;
  for (const child of children) {
    if (!isNodeActive(state, child)) throw new Error(`Assembly child node ${child} is inactive`);
    state.nodeParents[child] = node;
    state.nodeNextSibling[child] = -1;
    if (previous === -1) state.nodeFirstChild[node] = child;
    else state.nodeNextSibling[previous] = child;
    previous = child;
  }
  if (previous === -1) state.nodeFirstChild[node] = -1;
}

function isNodeActive(state: RuntimeState, node: number): boolean {
  return node >= 0 && node < state.nodeCount && state.nodeActive[node] === 1;
}

function reserveNodes(state: RuntimeState, required: number): void {
  if (required <= state.nodeCapacity) return;
  let capacity = Math.max(1, state.nodeCapacity);
  while (capacity < required) capacity *= 2;
  state.nodeAssemblyIds = growUint32(state.nodeAssemblyIds, capacity);
  state.nodeWorldTransforms = growFloat32(state.nodeWorldTransforms, capacity * 16);
  state.nodeParents = growInt32(state.nodeParents, capacity, -1);
  state.nodeFirstChild = growInt32(state.nodeFirstChild, capacity, -1);
  state.nodeNextSibling = growInt32(state.nodeNextSibling, capacity, -1);
  state.nodeAssemblyVisible = growUint8(state.nodeAssemblyVisible, capacity);
  state.nodeOverrideVisible = growUint8(state.nodeOverrideVisible, capacity);
  state.nodeEffectiveVisible = growUint8(state.nodeEffectiveVisible, capacity);
  state.nodeActive = growUint8(state.nodeActive, capacity);
  state.nodeNodeIds.length = capacity;
  state.nodeCapacity = capacity;
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

function growInt32(values: Int32Array, length: number, fill: number): Int32Array {
  const next = new Int32Array(length).fill(fill);
  next.set(values);
  return next;
}

function growFloat32(values: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length);
  next.set(values);
  return next;
}
