import type { Scene } from "../scene/scene";
import type { AssemblyId, AssemblyNodeId } from "../scene/types";
import { buildSceneDrafts, type InstanceDraft, type NodeDraft } from "./drafts";

/**
 * Packed CPU-side state backing a scene runtime. Every part placement is a
 * stable instance slot and every assembly expansion is a node in a compiled
 * tree. All arrays are indexed by node/instance ids and are never reordered,
 * so instance ids stay stable across visibility changes.
 */
export interface RuntimeState {
  readonly rootAssemblyId: AssemblyId;
  readonly nodeCount: number;
  readonly nodeNodeIds: readonly AssemblyNodeId[];
  readonly instanceCount: number;
  readonly nodeAssemblyIds: Uint32Array;
  readonly nodeParents: Int32Array;
  readonly nodeFirstChild: Int32Array;
  readonly nodeNextSibling: Int32Array;
  readonly nodeInstanceStart: Uint32Array;
  readonly nodeInstanceEnd: Uint32Array;
  readonly nodeVisible: Uint8Array;
  readonly nodeEffectiveVisible: Uint8Array;
  readonly nodeLocalTransforms: Float32Array;
  readonly nodeWorldTransforms: Float32Array;
  readonly instancePartIds: Uint32Array;
  readonly instanceOwningNode: Uint32Array;
  readonly instancePartVisible: Uint8Array;
  readonly instanceOverrideVisible: Uint8Array;
  readonly instanceVisible: Uint8Array;
  readonly instanceLocalTransforms: Float32Array;
  readonly instanceWorldTransforms: Float32Array;
  /** Authoring placement handle per instance, mirroring flatten paths. */
  readonly instanceInstanceIds: readonly string[];
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
  | "nodeVisible"
  | "nodeEffectiveVisible"
  | "nodeLocalTransforms"
  | "nodeWorldTransforms"
>;
type PackedInstances = Pick<
  RuntimeState,
  | "instanceCount"
  | "instancePartIds"
  | "instanceOwningNode"
  | "instancePartVisible"
  | "instanceOverrideVisible"
  | "instanceVisible"
  | "instanceLocalTransforms"
  | "instanceWorldTransforms"
  | "instanceInstanceIds"
> & { readonly visibleCount: number };

interface KeyedGroupIndex {
  readonly sortedKeys: Uint32Array;
  readonly offset: Uint32Array;
  readonly list: Uint32Array;
}

function packNodes(nodes: readonly NodeDraft[]): PackedNodes {
  const count = nodes.length;
  const nodeNodeIds: AssemblyNodeId[] = [];
  const nodeAssemblyIds = new Uint32Array(count);
  const nodeParents = new Int32Array(count);
  const nodeFirstChild = new Int32Array(count);
  const nodeNextSibling = new Int32Array(count);
  const nodeInstanceStart = new Uint32Array(count);
  const nodeInstanceEnd = new Uint32Array(count);
  const nodeVisible = new Uint8Array(count);
  const nodeEffectiveVisible = new Uint8Array(count);
  const nodeLocalTransforms = new Float32Array(count * 16);
  const nodeWorldTransforms = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const node = nodes[i];
    if (node === undefined) {
      continue;
    }
    nodeAssemblyIds[i] = node.assemblyId;
    nodeNodeIds.push(node.nodeId);
    nodeParents[i] = node.parent;
    nodeFirstChild[i] = node.firstChild;
    nodeNextSibling[i] = node.nextSibling;
    nodeInstanceStart[i] = node.instanceStart;
    nodeInstanceEnd[i] = node.instanceEnd;
    nodeVisible[i] = node.visible;
    nodeEffectiveVisible[i] = node.effective;
    nodeLocalTransforms.set(node.local, i * 16);
    nodeWorldTransforms.set(node.world, i * 16);
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
    nodeVisible,
    nodeEffectiveVisible,
    nodeLocalTransforms,
    nodeWorldTransforms,
  };
}

function packInstances(instances: readonly InstanceDraft[]): PackedInstances {
  const count = instances.length;
  const instancePartIds = new Uint32Array(count);
  const instanceOwningNode = new Uint32Array(count);
  const instancePartVisible = new Uint8Array(count);
  const instanceVisible = new Uint8Array(count);
  const instanceLocalTransforms = new Float32Array(count * 16);
  const instanceWorldTransforms = new Float32Array(count * 16);
  const instanceInstanceIds: string[] = [];
  let visibleCount = 0;
  for (let i = 0; i < count; i++) {
    const draft = instances[i];
    if (draft === undefined) {
      continue;
    }
    instancePartIds[i] = draft.partId;
    instanceOwningNode[i] = draft.owningNode;
    instancePartVisible[i] = draft.partVisible;
    instanceVisible[i] = draft.effective;
    if (draft.effective === 1) {
      visibleCount++;
    }
    instanceLocalTransforms.set(draft.local, i * 16);
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
    instanceLocalTransforms,
    instanceWorldTransforms,
    instanceInstanceIds,
  };
}

function buildGroups(keys: ArrayLike<number>): KeyedGroupIndex {
  const order = Array.from(keys, (_, index) => index);
  order.sort((a, b) => {
    const keyA = keys[a] ?? 0;
    const keyB = keys[b] ?? 0;
    return keyA - keyB || a - b;
  });
  const sortedKeys: number[] = [];
  const offset: number[] = [];
  const list: number[] = [];
  let previousKey = -1;
  for (let i = 0; i < order.length; i++) {
    const index = order[i];
    if (index === undefined) {
      continue;
    }
    const key = keys[index] ?? 0;
    if (i === 0 || key !== previousKey) {
      sortedKeys.push(key);
      offset.push(list.length);
      previousKey = key;
    }
    list.push(index);
  }
  offset.push(list.length);
  return {
    sortedKeys: new Uint32Array(sortedKeys),
    offset: new Uint32Array(offset),
    list: new Uint32Array(list),
  };
}

/**
 * Compiles an authoring scene into packed, deterministic runtime storage.
 * Missing assemblies are skipped defensively; hierarchy validation and cycle
 * behavior are owned by the scene builder.
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
    partInstanceOffset: partGroups.offset,
    partInstanceList: partGroups.list,
    sortedAssemblyIds: assemblyGroups.sortedKeys,
    assemblyNodeOffset: assemblyGroups.offset,
    assemblyNodeList: assemblyGroups.list,
  };
}
