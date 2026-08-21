import type { Scene } from "../scene/scene";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { buildSceneDrafts, type InstanceDraft, type NodeDraft } from "./drafts";
import { invariantValue } from "./invariants";
import type { KeyedGroupIndex } from "./group-index";
import { SlotGroups } from "./slot-groups";

/**
 * Packed CPU-side state backing a scene runtime. Every part placement is a
 * stable instance slot and every assembly expansion is a node in a compiled
 * tree. All arrays are indexed by node/instance ids and are never reordered,
 * so instance ids stay stable across visibility changes.
 */
export interface RuntimeState {
  readonly rootAssemblyId: AssemblyId;
  /** Allocated node extent. Removed nodes remain private holes until reused. */
  nodeCount: number;
  activeNodeCount: number;
  nodeCapacity: number;
  nodeNodeIds: AssemblyOccurrenceId[];
  /** Allocated slot extent. Removed slots remain private holes until reused. */
  instanceCount: number;
  activeInstanceCount: number;
  instanceCapacity: number;
  nodeAssemblyIds: Uint32Array;
  nodeWorldTransforms: Float32Array;
  nodeParents: Int32Array;
  nodeFirstChild: Int32Array;
  nodeNextSibling: Int32Array;
  nodeAssemblyVisible: Uint8Array;
  nodeOverrideVisible: Uint8Array;
  nodeEffectiveVisible: Uint8Array;
  nodeActive: Uint8Array;
  readonly nodeFreeSlots: number[];
  instancePartIds: Uint32Array;
  instanceOwningNode: Uint32Array;
  instancePartVisible: Uint8Array;
  instanceOverrideVisible: Uint8Array;
  instanceVisible: Uint8Array;
  instanceActive: Uint8Array;
  instanceWorldTransforms: Float32Array;
  /** Authoring placement handle per instance, mirroring flatten paths. */
  instanceInstanceIds: PartOccurrenceId[];
  readonly instanceFreeSlots: number[];
  readonly partInstanceGroups: SlotGroups;
  readonly nodeInstanceGroups: SlotGroups;
  sortedPartIds: Uint32Array;
  /** Mutable definition-to-expanded-node membership for hierarchy deltas. */
  readonly assemblyNodeGroups: SlotGroups;
  /** Direct part/assembly slots in authored order; assembly slots are bitwise-not encoded. */
  nodePlacementOrder: number[][];
  visibleCount: number;
}

type PackedNodes = Pick<
  RuntimeState,
  | "nodeCount"
  | "activeNodeCount"
  | "nodeCapacity"
  | "nodeNodeIds"
  | "nodeAssemblyIds"
  | "nodeWorldTransforms"
  | "nodeParents"
  | "nodeFirstChild"
  | "nodeNextSibling"
  | "nodeAssemblyVisible"
  | "nodeOverrideVisible"
  | "nodeEffectiveVisible"
  | "nodeActive"
  | "nodeFreeSlots"
>;
type PackedInstances = Pick<
  RuntimeState,
  | "instanceCount"
  | "activeInstanceCount"
  | "instanceCapacity"
  | "instancePartIds"
  | "instanceOwningNode"
  | "instancePartVisible"
  | "instanceOverrideVisible"
  | "instanceVisible"
  | "instanceActive"
  | "instanceWorldTransforms"
  | "instanceInstanceIds"
  | "instanceFreeSlots"
  | "partInstanceGroups"
  | "nodeInstanceGroups"
> & { readonly visibleCount: number };

function packNodes(nodes: readonly NodeDraft[]): PackedNodes {
  const count = nodes.length;
  const nodeNodeIds: AssemblyOccurrenceId[] = [];
  const nodeAssemblyIds = new Uint32Array(count);
  const nodeWorldTransforms = new Float32Array(count * 16);
  const nodeParents = new Int32Array(count);
  const nodeFirstChild = new Int32Array(count);
  const nodeNextSibling = new Int32Array(count);
  const nodeAssemblyVisible = new Uint8Array(count);
  const nodeEffectiveVisible = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const node = invariantValue(nodes[i], `node draft at ${i}`);
    nodeAssemblyIds[i] = node.assemblyId;
    nodeWorldTransforms.set(node.world, i * 16);
    nodeNodeIds.push(node.nodeId);
    nodeParents[i] = node.parent;
    nodeFirstChild[i] = node.firstChild;
    nodeNextSibling[i] = node.nextSibling;
    nodeAssemblyVisible[i] = node.visible;
    nodeEffectiveVisible[i] = node.effective;
  }
  return {
    nodeCount: count,
    activeNodeCount: count,
    nodeCapacity: count,
    nodeNodeIds,
    nodeAssemblyIds,
    nodeWorldTransforms,
    nodeParents,
    nodeFirstChild,
    nodeNextSibling,
    nodeAssemblyVisible,
    nodeOverrideVisible: new Uint8Array(count).fill(1),
    nodeEffectiveVisible,
    nodeActive: new Uint8Array(count).fill(1),
    nodeFreeSlots: [],
  };
}

function packInstances(instances: readonly InstanceDraft[]): PackedInstances {
  const count = instances.length;
  const instancePartIds = new Uint32Array(count);
  const instanceOwningNode = new Uint32Array(count);
  const instancePartVisible = new Uint8Array(count);
  const instanceVisible = new Uint8Array(count);
  const instanceWorldTransforms = new Float32Array(count * 16);
  const instanceInstanceIds: PartOccurrenceId[] = [];
  let visibleCount = 0;
  for (let i = 0; i < count; i++) {
    const draft = invariantValue(instances[i], `instance draft at ${i}`);
    instancePartIds[i] = draft.partId;
    instanceOwningNode[i] = draft.owningNode;
    instancePartVisible[i] = draft.partVisible;
    instanceVisible[i] = draft.effective;
    if (draft.effective === 1) {
      visibleCount++;
    }
    instanceWorldTransforms.set(draft.world, i * 16);
    instanceInstanceIds.push(draft.instanceId);
  }
  return {
    instanceCount: count,
    activeInstanceCount: count,
    instanceCapacity: count,
    visibleCount,
    instancePartIds,
    instanceOwningNode,
    instancePartVisible,
    instanceOverrideVisible: new Uint8Array(count).fill(1),
    instanceVisible,
    instanceActive: new Uint8Array(count).fill(1),
    instanceWorldTransforms,
    instanceInstanceIds,
    instanceFreeSlots: [],
    partInstanceGroups: new SlotGroups(instancePartIds),
    nodeInstanceGroups: new SlotGroups(instanceOwningNode),
  };
}

function buildGroups(keys: ArrayLike<number>): KeyedGroupIndex {
  const order = Array.from(keys, (_, index) => index);
  order.sort((a, b) => {
    const keyA = invariantValue(keys[a], `group key at ${a}`);
    const keyB = invariantValue(keys[b], `group key at ${b}`);
    return keyA - keyB || a - b;
  });
  const sortedKeys: number[] = [];
  const offset: number[] = [];
  const list: number[] = [];
  let previousKey: number | undefined;
  for (let i = 0; i < order.length; i++) {
    const index = invariantValue(order[i], `group order index at ${i}`);
    const key = invariantValue(keys[index], `group key at ${index}`);
    if (previousKey === undefined || key !== previousKey) {
      sortedKeys.push(key);
      offset.push(list.length);
      previousKey = key;
    }
    list.push(index);
  }
  offset.push(list.length);
  return {
    sortedKeys: new Uint32Array(sortedKeys),
    offsets: new Uint32Array(offset),
    list: new Uint32Array(list),
  };
}

/**
 * Compiles a validated authoring scene into packed, deterministic runtime
 * storage.
 */
export function compileSceneState(scene: Scene): RuntimeState {
  const { nodes, instances } = buildSceneDrafts(scene);
  const nodeData = packNodes(nodes);
  const instanceData = packInstances(instances);
  const partGroups = buildGroups(instanceData.instancePartIds);
  const state: RuntimeState = {
    rootAssemblyId: scene.rootAssemblyId,
    ...nodeData,
    ...instanceData,
    sortedPartIds: partGroups.sortedKeys,
    assemblyNodeGroups: new SlotGroups(nodeData.nodeAssemblyIds),
    nodePlacementOrder: [],
  };
  state.nodePlacementOrder = buildNodePlacementOrder(scene, state);
  return state;
}

function buildNodePlacementOrder(scene: Scene, state: RuntimeState): number[][] {
  const nodeById = new Map(state.nodeNodeIds.map((id, slot) => [id, slot]));
  const instanceById = new Map(state.instanceInstanceIds.map((id, slot) => [id, slot]));
  return Array.from({ length: state.nodeCount }, (_, node) => {
    const definition = invariantValue(
      scene.assemblies.get(invariantValue(state.nodeAssemblyIds[node], `assembly at ${node}`)),
      "assembly",
    );
    const ownerId = invariantValue(state.nodeNodeIds[node], `node id at ${node}`);
    return definition.placements.map((placement, index) => {
      const id = `${ownerId}/${placement.placementId ?? index}`;
      const slot = placement.kind === "part" ? instanceById.get(id) : nodeById.get(id);
      const resolved = invariantValue(slot, `placement ${id}`);
      return placement.kind === "part" ? resolved : ~resolved;
    });
  });
}
