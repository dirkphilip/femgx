import type { PartId } from "../geometry/part";
import { multiplyMatrices, type Mat4 } from "../math/mat4";
import type { AssemblyDefinition, Placement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { SceneStructuralChanges } from "../scene/update-changes";
import type { AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { equalPlacement } from "../scene/update-equality";
import { invariantValue } from "./invariants";
import { patchRetainedSubtree, relinkNodeOrder } from "./hierarchy-transform";
import { expandAssembly, hierarchyInstanceInput } from "./hierarchy-expand";
import { recordHierarchySlotAfter, recordHierarchySlotBefore } from "./hierarchy-slot-changes";
import type { RuntimeOccurrenceDelta, RuntimeOccurrenceSlotChange } from "./occurrence-update";
import type { PackedSceneRuntime, RuntimeInstanceInput } from "./runtime";

interface OwnerMutation {
  readonly node: number;
  readonly ownerId: AssemblyOccurrenceId;
  readonly before: ReadonlyMap<string, Placement>;
  readonly after: ReadonlyMap<string, Placement>;
}

/** Prepared private hierarchy edits, before any retained runtime state is changed. */
export interface PreparedHierarchyUpdate {
  readonly owners: readonly OwnerMutation[];
  readonly addedPartIds: ReadonlySet<PartId>;
  readonly replacedPartIds: ReadonlySet<PartId>;
  readonly removedPartIds: ReadonlySet<PartId>;
}

export interface RuntimeHierarchyDelta extends RuntimeOccurrenceDelta {
  readonly removedAssemblyOccurrenceIds: readonly AssemblyOccurrenceId[];
}

/** Prepares exact changed assembly owners before mutating retained runtime storage. */
export function prepareHierarchyMutations(
  runtime: PackedSceneRuntime,
  source: Scene,
  scene: Scene,
  changes: SceneStructuralChanges,
): PreparedHierarchyUpdate | undefined {
  const ownerDefinitions = affectedOwnerDefinitions(changes);
  if (ownerDefinitions.size === 0) return undefined;
  const owners: OwnerMutation[] = [];
  for (const assemblyId of ownerDefinitions) {
    const beforeDefinition = source.assemblies.get(assemblyId);
    const afterDefinition = scene.assemblies.get(assemblyId);
    if (beforeDefinition === undefined || afterDefinition === undefined) continue;
    if (samePlacementSequence(beforeDefinition, afterDefinition)) continue;
    const before = explicitPlacements(beforeDefinition);
    const after = explicitPlacements(afterDefinition);
    for (const node of runtime.getAssemblyNodeSlots(assemblyId)) {
      const ownerId = runtime.getNodeId(node);
      if (ownerId === undefined) return undefined;
      owners.push({ node, ownerId, before, after });
    }
  }
  return {
    owners,
    addedPartIds: changes.parts.added,
    replacedPartIds: changes.parts.replaced,
    removedPartIds: changes.parts.removed,
  };
}

/** Applies a prepared hierarchy change with retained surviving nodes and leaf slots. */
export function applyHierarchyMutations(
  runtime: PackedSceneRuntime,
  scene: Scene,
  prepared: PreparedHierarchyUpdate,
  resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean,
  resolveAssemblyVisible: (assemblyId: number, authoredVisible: boolean) => boolean,
): RuntimeHierarchyDelta {
  const removal = removeHierarchy(runtime, prepared.owners);
  const slotChanges = removal.slotChanges;
  const removedSlots = removal.removedSlots;
  runtime.removeInstances([...removedSlots]);
  runtime.removeAssemblyNodes(removal.removedNodes);
  const { additions, addedNodes } = applyOwners({
    runtime,
    scene,
    prepared,
    slotChanges,
    resolvePartVisible,
    resolveAssemblyVisible,
  });
  publishAdditions({ runtime, scene, prepared, additions, addedNodes, slotChanges });
  return hierarchyDelta(runtime, prepared, slotChanges, removedSlots, removal.removedOccurrenceIds);
}

function removeHierarchy(runtime: PackedSceneRuntime, owners: readonly OwnerMutation[]) {
  const removedRoots = hierarchyRemovalRoots(runtime, owners);
  const removedNodes = collectRemovedNodes(runtime, removedRoots);
  const removedOccurrenceIds = removedNodes.map((node) =>
    invariantValue(runtime.getNodeId(node), `removed assembly node id at ${node}`),
  );
  const removedNodeSet = new Set(removedNodes);
  const slotChanges = new Map<number, RuntimeOccurrenceSlotChange>();
  const removedSlots = directRemovedSlots(runtime, owners, removedNodeSet, slotChanges);
  for (const node of removedNodes) {
    for (const slot of runtime.getNodeInstanceSlots(node)) {
      recordHierarchySlotBefore(slotChanges, slot, runtime.getPartId(slot));
      removedSlots.add(slot);
    }
  }
  return { removedNodes, removedOccurrenceIds, removedSlots, slotChanges };
}

function applyOwners(context: {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly prepared: PreparedHierarchyUpdate;
  readonly slotChanges: Map<number, RuntimeOccurrenceSlotChange>;
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
  readonly resolveAssemblyVisible: (assemblyId: number, authoredVisible: boolean) => boolean;
}): { additions: RuntimeInstanceInput[]; addedNodes: number[] } {
  const additions: RuntimeInstanceInput[] = [];
  const addedNodes: number[] = [];
  for (const owner of context.prepared.owners) {
    if (context.runtime.getNodeId(owner.node) === undefined) continue;
    applyOwnerMutation({
      ...context,
      owner,
      additions,
      addedNodes,
    });
  }
  return { additions, addedNodes };
}

function publishAdditions(options: {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly prepared: PreparedHierarchyUpdate;
  readonly additions: readonly RuntimeInstanceInput[];
  readonly addedNodes: readonly number[];
  readonly slotChanges: Map<number, RuntimeOccurrenceSlotChange>;
}): void {
  const { runtime, scene, prepared, additions, addedNodes, slotChanges } = options;
  const slots = runtime.addInstances(additions);
  for (let index = 0; index < additions.length; index += 1) {
    const input = invariantValue(additions[index], `added hierarchy instance at ${index}`);
    const slot = invariantValue(slots[index], `added hierarchy slot at ${index}`);
    recordHierarchySlotBefore(slotChanges, slot, slotChanges.get(slot)?.beforePartId);
    recordHierarchySlotAfter(slotChanges, slot, input.partId);
  }
  for (const owner of prepared.owners) {
    if (runtime.getNodeId(owner.node) !== undefined) relinkNodeOrder(runtime, scene, owner.node);
  }
  for (const node of addedNodes) relinkNodeOrder(runtime, scene, node);
}

function hierarchyDelta(
  runtime: PackedSceneRuntime,
  prepared: PreparedHierarchyUpdate,
  slotChanges: Map<number, RuntimeOccurrenceSlotChange>,
  removedSlots: ReadonlySet<number>,
  removedAssemblyOccurrenceIds: readonly AssemblyOccurrenceId[],
): RuntimeHierarchyDelta {
  for (const partId of prepared.replacedPartIds) {
    for (const slot of runtime.getPartInstanceSlots(partId)) {
      recordHierarchySlotBefore(slotChanges, slot, partId);
      recordHierarchySlotAfter(slotChanges, slot, partId);
    }
  }
  const changed = [...slotChanges.values()].sort((left, right) => left.slot - right.slot);
  const affectedPartIds = new Set<PartId>();
  for (const change of changed) {
    if (change.beforePartId !== undefined) affectedPartIds.add(change.beforePartId);
    if (change.afterPartId !== undefined) affectedPartIds.add(change.afterPartId);
  }
  for (const partId of prepared.removedPartIds) affectedPartIds.add(partId);
  return {
    slots: changed,
    affectedPartIds,
    removedOccurrenceSlots: [...removedSlots],
    addedPartIds: prepared.addedPartIds,
    removedPartIds: prepared.removedPartIds,
    removedAssemblyOccurrenceIds,
  };
}

function affectedOwnerDefinitions(changes: SceneStructuralChanges): Set<number> {
  const ids = new Set<number>();
  for (const change of changes.placements) {
    ids.add(change.ownerAssemblyId);
  }
  for (const id of changes.assemblies.replaced) ids.add(id);
  return ids;
}

function samePlacementSequence(before: AssemblyDefinition, after: AssemblyDefinition): boolean {
  return (
    before.placements.length === after.placements.length &&
    before.placements.every((placement, index) =>
      equalPlacement(placement, after.placements[index]),
    )
  );
}

function explicitPlacements(assembly: AssemblyDefinition): ReadonlyMap<string, Placement> {
  const placements = new Map<string, Placement>();
  for (const placement of assembly.placements) {
    if (placement.placementId === undefined) {
      throw new Error(
        `AssemblyDefinition ${assembly.id} uses an implicit placement identity; migrate it before a live hierarchy edit`,
      );
    }
    if (placements.has(placement.placementId)) {
      throw new Error(
        `AssemblyDefinition ${assembly.id} contains duplicate placement id ${placement.placementId}`,
      );
    }
    placements.set(placement.placementId, placement);
  }
  return placements;
}

function hierarchyRemovalRoots(
  runtime: PackedSceneRuntime,
  owners: readonly OwnerMutation[],
): number[] {
  const roots: number[] = [];
  for (const owner of owners) {
    for (const [id, before] of owner.before) {
      const after = owner.after.get(id);
      if (
        before.kind !== "assembly" ||
        (after?.kind === "assembly" && after.assemblyId === before.assemblyId)
      )
        continue;
      const node = runtime.getNodeSlot(path(owner.ownerId, id));
      if (node === undefined)
        throw new Error(`Missing assembly occurrence ${path(owner.ownerId, id)}`);
      roots.push(node);
    }
  }
  return roots;
}

function collectRemovedNodes(runtime: PackedSceneRuntime, roots: readonly number[]): number[] {
  const removed = new Set<number>();
  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const node = invariantValue(stack.pop(), "removed hierarchy node");
      if (removed.has(node)) continue;
      removed.add(node);
      let child = runtime.nodeFirstChild[node] ?? -1;
      while (child !== -1) {
        stack.push(child);
        child = runtime.nodeNextSibling[child] ?? -1;
      }
    }
  }
  return [...removed].sort((left, right) => right - left);
}

function directRemovedSlots(
  runtime: PackedSceneRuntime,
  owners: readonly OwnerMutation[],
  removedNodes: ReadonlySet<number>,
  changes: Map<number, RuntimeOccurrenceSlotChange>,
): Set<number> {
  const slots = new Set<number>();
  for (const owner of owners) {
    if (removedNodes.has(owner.node)) continue;
    for (const [id, before] of owner.before) {
      const after = owner.after.get(id);
      if (before.kind !== "part" || (after !== undefined && after.kind === "part")) continue;
      const slot = runtime.getInstanceSlot(path(owner.ownerId, id));
      if (slot === undefined) throw new Error(`Missing part occurrence ${path(owner.ownerId, id)}`);
      recordHierarchySlotBefore(changes, slot, runtime.getPartId(slot));
      slots.add(slot);
    }
  }
  return slots;
}

interface OwnerApplyContext {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly owner: OwnerMutation;
  readonly additions: RuntimeInstanceInput[];
  readonly slotChanges: Map<number, RuntimeOccurrenceSlotChange>;
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
  readonly resolveAssemblyVisible: (assemblyId: number, authoredVisible: boolean) => boolean;
  readonly addedNodes: number[];
}

function applyOwnerMutation(context: OwnerApplyContext): void {
  const {
    runtime,
    scene,
    owner,
    additions,
    resolvePartVisible,
    resolveAssemblyVisible,
    addedNodes,
  } = context;
  const ownerWorld = nodeWorld(runtime, owner.node);
  for (const [id, after] of owner.after) {
    const before = owner.before.get(id);
    if (before !== undefined && equalPlacement(before, after)) continue;
    const occurrenceId = path(owner.ownerId, id);
    const world = multiplyMatrices(ownerWorld, after.transform);
    if (after.kind === "part") {
      applyPartPlacement(context, occurrenceId, before, after, world);
      continue;
    }
    if (before?.kind === "assembly" && before.assemblyId === after.assemblyId) {
      const node = invariantValue(runtime.getNodeSlot(occurrenceId), `assembly ${occurrenceId}`);
      patchRetainedSubtree(runtime, scene, node, world, resolvePartVisible);
      continue;
    }
    expandAssembly({
      runtime,
      scene,
      assemblyId: after.assemblyId,
      nodeId: occurrenceId,
      parent: owner.node,
      world,
      additions,
      resolvePartVisible,
      resolveAssemblyVisible,
      addedNodes,
    });
  }
  relinkOwnerChildren(runtime, owner);
}

function applyPartPlacement(
  context: OwnerApplyContext,
  occurrenceId: PartOccurrenceId,
  before: Placement | undefined,
  after: Extract<Placement, { readonly kind: "part" }>,
  world: Mat4,
): void {
  const slot = before?.kind === "part" ? context.runtime.getInstanceSlot(occurrenceId) : undefined;
  const input = hierarchyInstanceInput({
    scene: context.scene,
    node: context.owner.node,
    id: occurrenceId,
    placement: after,
    world,
    resolvePartVisible: context.resolvePartVisible,
    ...(slot === undefined
      ? {}
      : { overrideVisible: context.runtime.instanceOverrideVisible[slot] === 1 }),
  });
  if (slot === undefined) {
    context.additions.push(input);
    return;
  }
  recordHierarchySlotBefore(context.slotChanges, slot, context.runtime.getPartId(slot));
  context.runtime.updateInstance(slot, input);
  recordHierarchySlotAfter(context.slotChanges, slot, after.partId);
}

function relinkOwnerChildren(runtime: PackedSceneRuntime, owner: OwnerMutation): void {
  const children: number[] = [];
  for (const placement of owner.after.values()) {
    if (placement.kind !== "assembly") continue;
    const id = invariantValue(placement.placementId, "explicit hierarchy placement id");
    const child = runtime.getNodeSlot(path(owner.ownerId, id));
    if (child === undefined) throw new Error(`Missing hierarchy child ${path(owner.ownerId, id)}`);
    children.push(child);
  }
  runtime.setNodeChildren(owner.node, children);
}

function path(
  owner: AssemblyOccurrenceId,
  placementId: string,
): AssemblyOccurrenceId & PartOccurrenceId {
  return `${owner}/${placementId}`;
}

function nodeWorld(runtime: PackedSceneRuntime, node: number): Mat4 {
  return runtime.nodeWorldTransforms.subarray(node * 16, node * 16 + 16);
}
