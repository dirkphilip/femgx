import { identity, multiply, type Mat4 } from "../mat4";
import type { Scene } from "../scene";
import type { AssemblyId, PartId } from "../types";

/**
 * Packed CPU-side state backing a scene runtime. Every part placement is a
 * stable instance slot and every assembly expansion is a node in a compiled
 * tree. All arrays are indexed by node/instance ids and are never reordered,
 * so instance ids stay stable across visibility changes.
 */
export interface RuntimeState {
  readonly rootAssemblyId: AssemblyId;
  readonly nodeCount: number;
  readonly instanceCount: number;
  readonly nodeAssemblyIds: Uint32Array;
  readonly nodeParents: Int32Array;
  readonly nodeFirstChild: Int32Array;
  readonly nodeNextSibling: Int32Array;
  readonly nodeInstanceStart: Uint32Array;
  readonly nodeInstanceEnd: Uint32Array;
  readonly nodeVisible: Uint8Array;
  readonly nodeEffectiveVisible: Uint8Array;
  readonly instancePartIds: Uint32Array;
  readonly instanceOwningNode: Uint32Array;
  readonly instancePartVisible: Uint8Array;
  readonly instanceOverrideVisible: Uint8Array;
  readonly instanceVisible: Uint8Array;
  readonly instanceWorldTransforms: Float32Array;
  readonly sortedPartIds: Uint32Array;
  readonly partInstanceOffset: Uint32Array;
  readonly partInstanceList: Uint32Array;
  readonly sortedAssemblyIds: Uint32Array;
  readonly assemblyNodeOffset: Uint32Array;
  readonly assemblyNodeList: Uint32Array;
  visibleCount: number;
}

interface NodeDraft {
  readonly assemblyId: AssemblyId;
  readonly parent: number;
  firstChild: number;
  nextSibling: number;
  lastChild: number;
  readonly instanceStart: number;
  instanceEnd: number;
  readonly visible: 0 | 1;
  readonly effective: 0 | 1;
}

interface InstanceDraft {
  readonly partId: PartId;
  readonly owningNode: number;
  readonly partVisible: 0 | 1;
  readonly effective: 0 | 1;
  readonly transform: Mat4;
}

type PackedNodes = Pick<
  RuntimeState,
  | "nodeCount"
  | "nodeAssemblyIds"
  | "nodeParents"
  | "nodeFirstChild"
  | "nodeNextSibling"
  | "nodeInstanceStart"
  | "nodeInstanceEnd"
  | "nodeVisible"
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
> & { readonly visibleCount: number };

interface KeyedGroupIndex {
  readonly sortedKeys: Uint32Array;
  readonly offset: Uint32Array;
  readonly list: Uint32Array;
}

function linkChild(nodes: NodeDraft[], parent: number, nodeIndex: number): void {
  const parentNode = nodes[parent];
  if (parentNode === undefined) {
    return;
  }
  if (parentNode.firstChild === -1) {
    parentNode.firstChild = nodeIndex;
  } else {
    const previousSibling = nodes[parentNode.lastChild];
    if (previousSibling !== undefined) {
      previousSibling.nextSibling = nodeIndex;
    }
  }
  parentNode.lastChild = nodeIndex;
}

function buildSceneDrafts(scene: Scene): { nodes: NodeDraft[]; instances: InstanceDraft[] } {
  const nodes: NodeDraft[] = [];
  const instances: InstanceDraft[] = [];
  const { assemblies, visibleAssemblyIds, visiblePartIds } = scene;
  const walk = (
    assemblyId: AssemblyId,
    parent: number,
    parentTransform: Mat4,
    parentEffective: 0 | 1,
  ): void => {
    const assembly = assemblies.get(assemblyId);
    if (assembly === undefined) {
      return;
    }
    const nodeIndex = nodes.length;
    const visible: 0 | 1 = visibleAssemblyIds.has(assemblyId) ? 1 : 0;
    const effective: 0 | 1 = visible === 1 && parentEffective === 1 ? 1 : 0;
    const node: NodeDraft = {
      assemblyId,
      parent,
      firstChild: -1,
      nextSibling: -1,
      lastChild: -1,
      instanceStart: instances.length,
      instanceEnd: -1,
      visible,
      effective,
    };
    nodes.push(node);
    if (parent !== -1) {
      linkChild(nodes, parent, nodeIndex);
    }
    for (const placement of assembly.placements) {
      const worldTransform = multiply(parentTransform, placement.transform);
      if (placement.kind === "part") {
        const partVisible: 0 | 1 = visiblePartIds.has(placement.partId) ? 1 : 0;
        const instanceEffective: 0 | 1 = effective === 1 && partVisible === 1 ? 1 : 0;
        instances.push({
          partId: placement.partId,
          owningNode: nodeIndex,
          partVisible,
          effective: instanceEffective,
          transform: worldTransform,
        });
      } else {
        walk(placement.assemblyId, nodeIndex, worldTransform, effective);
      }
    }
    node.instanceEnd = instances.length;
  };
  walk(scene.rootAssemblyId, -1, identity(), 1);
  return { nodes, instances };
}

function packNodes(nodes: readonly NodeDraft[]): PackedNodes {
  const count = nodes.length;
  const nodeAssemblyIds = new Uint32Array(count);
  const nodeParents = new Int32Array(count);
  const nodeFirstChild = new Int32Array(count);
  const nodeNextSibling = new Int32Array(count);
  const nodeInstanceStart = new Uint32Array(count);
  const nodeInstanceEnd = new Uint32Array(count);
  const nodeVisible = new Uint8Array(count);
  const nodeEffectiveVisible = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const node = nodes[i];
    if (node === undefined) {
      continue;
    }
    nodeAssemblyIds[i] = node.assemblyId;
    nodeParents[i] = node.parent;
    nodeFirstChild[i] = node.firstChild;
    nodeNextSibling[i] = node.nextSibling;
    nodeInstanceStart[i] = node.instanceStart;
    nodeInstanceEnd[i] = node.instanceEnd;
    nodeVisible[i] = node.visible;
    nodeEffectiveVisible[i] = node.effective;
  }
  return {
    nodeCount: count,
    nodeAssemblyIds,
    nodeParents,
    nodeFirstChild,
    nodeNextSibling,
    nodeInstanceStart,
    nodeInstanceEnd,
    nodeVisible,
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
    instanceWorldTransforms.set(draft.transform, i * 16);
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
 * Mirrors `flattenAssembly` semantics: missing assemblies are skipped and
 * hierarchy validation/cycle behavior is unchanged.
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
