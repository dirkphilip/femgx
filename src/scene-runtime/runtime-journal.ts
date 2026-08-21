import type { Mat4 } from "../math/mat4";
import type { AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import type { RuntimeState } from "./compile";

interface RuntimeJournalTransaction {
  commit(): void;
  rollback(): void;
}

interface JournalInstanceInput {
  readonly instanceId: PartOccurrenceId;
}

interface RuntimeMapsView {
  readonly instanceSlots: Map<PartOccurrenceId, number>;
  readonly nodeSlots: Map<AssemblyOccurrenceId, number>;
}

export interface RuntimeJournalOwner {
  readonly begin: () => RuntimeJournalTransaction;
  readonly captureInstances: (slots: readonly number[]) => void;
  readonly captureAddedInstances: (inputs: readonly JournalInstanceInput[]) => void;
  readonly touchInstanceId: (id: PartOccurrenceId) => void;
  readonly captureNodes: (nodes: readonly number[]) => void;
  readonly captureAddedNode: (id: AssemblyOccurrenceId) => void;
  readonly captureNodeLinks: (node: number, children: readonly number[]) => void;
}

/** Owns one sparse hierarchy rollback journal without cloning retained runtime storage. */
export function createRuntimeJournalOwner(
  state: RuntimeState,
  maps: RuntimeMapsView,
): RuntimeJournalOwner {
  let active: RuntimeJournal | undefined;
  return {
    begin: () => {
      if (active !== undefined) throw new Error("A hierarchy transaction is already active");
      active = new RuntimeJournal(state, maps, () => (active = undefined));
      return active;
    },
    captureInstances: (slots) => active?.captureInstances(slots),
    captureAddedInstances: (inputs) => active?.captureAddedInstances(inputs),
    touchInstanceId: (id) => active?.instanceIds.add(id),
    captureNodes: (nodes) => active?.captureNodes(nodes),
    captureAddedNode: (id) => active?.captureAddedNode(id),
    captureNodeLinks: (node, children) => active?.captureNodeLinks(node, children),
  };
}

class RuntimeJournal implements RuntimeJournalTransaction {
  public readonly instanceIds = new Set<PartOccurrenceId>();
  private readonly nodeIds = new Set<AssemblyOccurrenceId>();
  private readonly instances = new Map<number, InstanceRecord>();
  private readonly nodes = new Map<number, NodeRecord>();
  private readonly snapshot: RuntimeSnapshot;
  private finished = false;

  constructor(
    private readonly state: RuntimeState,
    private readonly maps: RuntimeMapsView,
    private readonly finish: () => void,
  ) {
    this.snapshot = snapshotRuntime(state);
    state.partInstanceGroups.beginJournal();
    state.nodeInstanceGroups.beginJournal();
    state.assemblyNodeGroups.beginJournal();
  }

  captureInstances(slots: readonly number[]): void {
    for (const slot of slots) this.captureInstance(slot);
  }

  captureAddedInstances(inputs: readonly JournalInstanceInput[]): void {
    let free = this.state.instanceFreeSlots.length - 1;
    let next = this.state.instanceCount;
    for (const input of inputs) {
      const slot = free >= 0 ? this.state.instanceFreeSlots[free--] : next++;
      if (slot !== undefined) this.captureInstance(slot);
      this.instanceIds.add(input.instanceId);
    }
  }

  captureNodes(nodes: readonly number[]): void {
    for (const node of nodes) this.captureNode(node);
  }

  captureAddedNode(id: AssemblyOccurrenceId): void {
    const slot = this.state.nodeFreeSlots.at(-1) ?? this.state.nodeCount;
    this.captureNode(slot);
    this.nodeIds.add(id);
  }

  captureNodeLinks(node: number, children: readonly number[]): void {
    this.captureNode(node);
    for (const child of children) this.captureNode(child);
    let child = this.state.nodeFirstChild[node] ?? -1;
    while (child !== -1) {
      this.captureNode(child);
      child = this.state.nodeNextSibling[child] ?? -1;
    }
  }

  commit(): void {
    this.assertActive();
    this.state.partInstanceGroups.commitJournal();
    this.state.nodeInstanceGroups.commitJournal();
    this.state.assemblyNodeGroups.commitJournal();
    this.finished = true;
    this.finish();
  }

  rollback(): void {
    this.assertActive();
    restoreRuntime(this.state, this.snapshot);
    for (const [slot, record] of this.instances) {
      if (slot < this.snapshot.instanceCapacity) restoreInstance(this.state, slot, record);
    }
    for (const [node, record] of this.nodes) {
      if (node < this.snapshot.nodeCapacity) restoreNode(this.state, node, record);
    }
    restoreMaps(this.maps, this.instanceIds, this.nodeIds, this.instances, this.nodes);
    this.state.partInstanceGroups.rollbackJournal();
    this.state.nodeInstanceGroups.rollbackJournal();
    this.state.assemblyNodeGroups.rollbackJournal();
    this.finished = true;
    this.finish();
  }

  private captureInstance(slot: number): void {
    if (this.instances.has(slot)) return;
    const id = this.state.instanceInstanceIds[slot];
    if (id !== undefined && id !== "") this.instanceIds.add(id);
    this.instances.set(slot, instanceRecord(this.state, slot));
  }

  private captureNode(node: number): void {
    if (this.nodes.has(node)) return;
    const id = this.state.nodeNodeIds[node];
    if (id !== undefined && id !== "") this.nodeIds.add(id);
    this.nodes.set(node, nodeRecord(this.state, node));
  }

  private assertActive(): void {
    if (this.finished) throw new Error("Hierarchy transaction is already finished");
  }
}

interface RuntimeSnapshot {
  readonly nodeCount: number;
  readonly activeNodeCount: number;
  readonly nodeCapacity: number;
  readonly instanceCount: number;
  readonly activeInstanceCount: number;
  readonly instanceCapacity: number;
  readonly visibleCount: number;
  readonly nodeFreeSlots: readonly number[];
  readonly instanceFreeSlots: readonly number[];
  readonly sortedPartIds: Uint32Array;
  readonly arrays: Pick<
    RuntimeState,
    | "nodeAssemblyIds"
    | "nodeWorldTransforms"
    | "nodeParents"
    | "nodeFirstChild"
    | "nodeNextSibling"
    | "nodeAssemblyVisible"
    | "nodeOverrideVisible"
    | "nodeEffectiveVisible"
    | "nodeActive"
    | "nodeNodeIds"
    | "nodePlacementOrder"
    | "instancePartIds"
    | "instanceOwningNode"
    | "instancePartVisible"
    | "instanceOverrideVisible"
    | "instanceVisible"
    | "instanceActive"
    | "instanceWorldTransforms"
    | "instanceInstanceIds"
  >;
}

function snapshotRuntime(state: RuntimeState): RuntimeSnapshot {
  return {
    nodeCount: state.nodeCount,
    activeNodeCount: state.activeNodeCount,
    nodeCapacity: state.nodeCapacity,
    instanceCount: state.instanceCount,
    activeInstanceCount: state.activeInstanceCount,
    instanceCapacity: state.instanceCapacity,
    visibleCount: state.visibleCount,
    nodeFreeSlots: [...state.nodeFreeSlots],
    instanceFreeSlots: [...state.instanceFreeSlots],
    sortedPartIds: state.sortedPartIds,
    arrays: {
      nodeAssemblyIds: state.nodeAssemblyIds,
      nodeWorldTransforms: state.nodeWorldTransforms,
      nodeParents: state.nodeParents,
      nodeFirstChild: state.nodeFirstChild,
      nodeNextSibling: state.nodeNextSibling,
      nodeAssemblyVisible: state.nodeAssemblyVisible,
      nodeOverrideVisible: state.nodeOverrideVisible,
      nodeEffectiveVisible: state.nodeEffectiveVisible,
      nodeActive: state.nodeActive,
      nodeNodeIds: state.nodeNodeIds,
      nodePlacementOrder: state.nodePlacementOrder,
      instancePartIds: state.instancePartIds,
      instanceOwningNode: state.instanceOwningNode,
      instancePartVisible: state.instancePartVisible,
      instanceOverrideVisible: state.instanceOverrideVisible,
      instanceVisible: state.instanceVisible,
      instanceActive: state.instanceActive,
      instanceWorldTransforms: state.instanceWorldTransforms,
      instanceInstanceIds: state.instanceInstanceIds,
    },
  };
}

function restoreRuntime(state: RuntimeState, before: RuntimeSnapshot): void {
  Object.assign(state, before.arrays, {
    nodeCount: before.nodeCount,
    activeNodeCount: before.activeNodeCount,
    nodeCapacity: before.nodeCapacity,
    instanceCount: before.instanceCount,
    activeInstanceCount: before.activeInstanceCount,
    instanceCapacity: before.instanceCapacity,
    visibleCount: before.visibleCount,
    sortedPartIds: before.sortedPartIds,
  });
  state.nodeFreeSlots.splice(0, state.nodeFreeSlots.length, ...before.nodeFreeSlots);
  state.instanceFreeSlots.splice(0, state.instanceFreeSlots.length, ...before.instanceFreeSlots);
  state.nodeNodeIds.length = before.nodeCapacity;
  state.nodePlacementOrder.length = before.nodeCapacity;
  state.instanceInstanceIds.length = before.instanceCapacity;
}

interface InstanceRecord {
  readonly values: readonly number[];
  readonly id: PartOccurrenceId | undefined;
  readonly transform: Mat4;
}
interface NodeRecord {
  readonly values: readonly number[];
  readonly id: AssemblyOccurrenceId | undefined;
  readonly transform: Mat4;
  readonly order: readonly number[] | undefined;
}

function instanceRecord(state: RuntimeState, slot: number): InstanceRecord {
  return {
    values: [
      state.instancePartIds[slot] ?? 0,
      state.instanceOwningNode[slot] ?? 0,
      state.instancePartVisible[slot] ?? 0,
      state.instanceOverrideVisible[slot] ?? 0,
      state.instanceVisible[slot] ?? 0,
      state.instanceActive[slot] ?? 0,
    ],
    id: state.instanceInstanceIds[slot],
    transform: state.instanceWorldTransforms.slice(slot * 16, slot * 16 + 16),
  };
}

function nodeRecord(state: RuntimeState, node: number): NodeRecord {
  return {
    values: [
      state.nodeAssemblyIds[node] ?? 0,
      state.nodeParents[node] ?? -1,
      state.nodeFirstChild[node] ?? -1,
      state.nodeNextSibling[node] ?? -1,
      state.nodeAssemblyVisible[node] ?? 0,
      state.nodeOverrideVisible[node] ?? 0,
      state.nodeEffectiveVisible[node] ?? 0,
      state.nodeActive[node] ?? 0,
    ],
    id: state.nodeNodeIds[node],
    transform: state.nodeWorldTransforms.slice(node * 16, node * 16 + 16),
    order: state.nodePlacementOrder[node],
  };
}

function restoreInstance(state: RuntimeState, slot: number, record: InstanceRecord): void {
  const [part, owner, partVisible, override, visible, active] = record.values;
  state.instancePartIds[slot] = part ?? 0;
  state.instanceOwningNode[slot] = owner ?? 0;
  state.instancePartVisible[slot] = partVisible ?? 0;
  state.instanceOverrideVisible[slot] = override ?? 0;
  state.instanceVisible[slot] = visible ?? 0;
  state.instanceActive[slot] = active ?? 0;
  state.instanceInstanceIds[slot] = record.id ?? "";
  state.instanceWorldTransforms.set(record.transform, slot * 16);
}

function restoreNode(state: RuntimeState, node: number, record: NodeRecord): void {
  const [assembly, parent, first, next, visible, override, effective, active] = record.values;
  state.nodeAssemblyIds[node] = assembly ?? 0;
  state.nodeParents[node] = parent ?? -1;
  state.nodeFirstChild[node] = first ?? -1;
  state.nodeNextSibling[node] = next ?? -1;
  state.nodeAssemblyVisible[node] = visible ?? 0;
  state.nodeOverrideVisible[node] = override ?? 0;
  state.nodeEffectiveVisible[node] = effective ?? 0;
  state.nodeActive[node] = active ?? 0;
  state.nodeNodeIds[node] = record.id ?? "";
  state.nodePlacementOrder[node] = [...(record.order ?? [])];
  state.nodeWorldTransforms.set(record.transform, node * 16);
}

function restoreMaps(
  maps: RuntimeMapsView,
  instanceIds: ReadonlySet<PartOccurrenceId>,
  nodeIds: ReadonlySet<AssemblyOccurrenceId>,
  instances: ReadonlyMap<number, InstanceRecord>,
  nodes: ReadonlyMap<number, NodeRecord>,
): void {
  for (const id of instanceIds) maps.instanceSlots.delete(id);
  for (const id of nodeIds) maps.nodeSlots.delete(id);
  for (const [slot, record] of instances)
    if (record.id !== undefined && record.id !== "") maps.instanceSlots.set(record.id, slot);
  for (const [node, record] of nodes)
    if (record.id !== undefined && record.id !== "") maps.nodeSlots.set(record.id, node);
}
