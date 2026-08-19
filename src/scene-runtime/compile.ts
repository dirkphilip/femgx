import type { Scene } from "../scene/scene";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { buildSceneDrafts, type InstanceDraft, type NodeDraft } from "./drafts";
import { invariantValue } from "./invariants";
import type { KeyedGroupIndex } from "./group-index";

/**
 * Packed CPU-side state backing a scene runtime. Every part placement is a
 * stable instance slot and every assembly expansion is a node in a compiled
 * tree. All arrays are indexed by node/instance ids and are never reordered,
 * so instance ids stay stable across visibility changes.
 */
export interface RuntimeState {
  readonly rootAssemblyId: AssemblyId;
  readonly nodeCount: number;
  readonly nodeNodeIds: readonly AssemblyOccurrenceId[];
  readonly instanceCount: number;
  readonly nodeAssemblyIds: Uint32Array;
  readonly nodeParents: Int32Array;
  readonly nodeFirstChild: Int32Array;
  readonly nodeNextSibling: Int32Array;
  readonly nodeInstanceStart: Uint32Array;
  readonly nodeInstanceEnd: Uint32Array;
  readonly nodeAssemblyVisible: Uint8Array;
  readonly nodeOverrideVisible: Uint8Array;
  readonly nodeEffectiveVisible: Uint8Array;
  readonly instancePartIds: Uint32Array;
  readonly instanceOwningNode: Uint32Array;
  readonly instancePartVisible: Uint8Array;
  readonly instanceOverrideVisible: Uint8Array;
  readonly instanceVisible: Uint8Array;
  readonly instanceWorldTransforms: Float32Array;
  /** Authoring placement handle per instance, mirroring flatten paths. */
  readonly instanceInstanceIds: readonly PartOccurrenceId[];
  readonly sortedPartIds: Uint32Array;
  readonly partInstanceOffset: Uint32Array;
  readonly partInstanceList: Uint32Array;
  readonly sortedAssemblyIds: Uint32Array;
  readonly assemblyNodeOffset: Uint32Array;
  readonly assemblyNodeList: Uint32Array;
  visibleCount: number;
}

type PackedNodes = Pick<
  RuntimeState,
  | "nodeCount"
  | "nodeNodeIds"
  | "nodeAssemblyIds"
  | "nodeParents"
  | "nodeFirstChild"
  | "nodeNextSibling"
  | "nodeInstanceStart"
  | "nodeInstanceEnd"
  | "nodeAssemblyVisible"
  | "nodeOverrideVisible"
  | "nodeEffectiveVisible"
>;
type PackedInstances = Pick<
  RuntimeState,
  | "instanceCount"
  | "instancePartIds"
  | "instanceOwningNode"
  | "instancePartVisible"
  | "instanceOverrideVisible"
  | "instanceVisible"
  | "instanceWorldTransforms"
  | "instanceInstanceIds"
> & { readonly visibleCount: number };

function packNodes(nodes: readonly NodeDraft[]): PackedNodes {
  const count = nodes.length;
  const nodeNodeIds: AssemblyOccurrenceId[] = [];
  const nodeAssemblyIds = new Uint32Array(count);
  const nodeParents = new Int32Array(count);
  const nodeFirstChild = new Int32Array(count);
  const nodeNextSibling = new Int32Array(count);
  const nodeInstanceStart = new Uint32Array(count);
  const nodeInstanceEnd = new Uint32Array(count);
  const nodeAssemblyVisible = new Uint8Array(count);
  const nodeEffectiveVisible = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const node = invariantValue(nodes[i], `node draft at ${i}`);
    nodeAssemblyIds[i] = node.assemblyId;
    nodeNodeIds.push(node.nodeId);
    nodeParents[i] = node.parent;
    nodeFirstChild[i] = node.firstChild;
    nodeNextSibling[i] = node.nextSibling;
    nodeInstanceStart[i] = node.instanceStart;
    nodeInstanceEnd[i] = node.instanceEnd;
    nodeAssemblyVisible[i] = node.visible;
    nodeEffectiveVisible[i] = node.effective;
  }
  return {
    nodeCount: count,
    nodeNodeIds,
    nodeAssemblyIds,
    nodeParents,
    nodeFirstChild,
    nodeNextSibling,
    nodeInstanceStart,
    nodeInstanceEnd,
    nodeAssemblyVisible,
    nodeOverrideVisible: new Uint8Array(count).fill(1),
    nodeEffectiveVisible,
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
    visibleCount,
    instancePartIds,
    instanceOwningNode,
    instancePartVisible,
    instanceOverrideVisible: new Uint8Array(count).fill(1),
    instanceVisible,
    instanceWorldTransforms,
    instanceInstanceIds,
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
  const assemblyGroups = buildGroups(nodeData.nodeAssemblyIds);
  return {
    rootAssemblyId: scene.rootAssemblyId,
    ...nodeData,
    ...instanceData,
    sortedPartIds: partGroups.sortedKeys,
    partInstanceOffset: partGroups.offsets,
    partInstanceList: partGroups.list,
    sortedAssemblyIds: assemblyGroups.sortedKeys,
    assemblyNodeOffset: assemblyGroups.offsets,
    assemblyNodeList: assemblyGroups.list,
  };
}
