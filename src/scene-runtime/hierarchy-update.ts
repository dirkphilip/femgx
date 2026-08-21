import type { PartId } from "../geometry/part";
import { multiplyMatrices, type Mat4 } from "../math/mat4";
import type { AssemblyDefinition, Placement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { SceneStructuralChanges } from "../scene/update-changes";
import type { AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import { equalPlacement } from "../scene/update-equality";
import { invariantValue } from "./invariants";
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
  readonly changedAssemblyIds: ReadonlySet<number>;
  readonly addedPartIds: ReadonlySet<PartId>;
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
    if (samePlacementMaps(before, after)) continue;
    for (const node of runtime.getAssemblyNodeSlots(assemblyId)) {
      const ownerId = runtime.getNodeId(node);
      if (ownerId === undefined) return undefined;
      owners.push({ node, ownerId, before, after });
    }
  }
  return {
    owners,
    changedAssemblyIds: changedAssemblyIds(changes),
    addedPartIds: changes.parts.added,
    removedPartIds: changes.parts.removed,
  };
}

function changedAssemblyIds(changes: SceneStructuralChanges): Set<number> {
  return new Set([
    ...changes.assemblies.added,
    ...changes.assemblies.replaced,
    ...changes.assemblies.removed,
  ]);
}

/** Applies a prepared hierarchy change with retained surviving nodes and leaf slots. */
export function applyHierarchyMutations(
  runtime: PackedSceneRuntime,
  scene: Scene,
  prepared: PreparedHierarchyUpdate,
  resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean,
  resolveAssemblyVisible: (assemblyId: number, authoredVisible: boolean) => boolean,
): RuntimeHierarchyDelta {
  const removedRoots = hierarchyRemovalRoots(runtime, prepared.owners);
  const removedNodes = collectRemovedNodes(runtime, removedRoots);
  const removedAssemblyOccurrenceIds = removedNodes.map((node) =>
    invariantValue(runtime.getNodeId(node), `removed assembly node id at ${node}`),
  );
  const removedNodeSet = new Set(removedNodes);
  const slotChanges = new Map<number, RuntimeOccurrenceSlotChange>();
  const removedSlots = directRemovedSlots(runtime, prepared.owners, removedNodeSet, slotChanges);
  for (const node of removedNodes) {
    for (const slot of runtime.getNodeInstanceSlots(node)) {
      recordHierarchySlotBefore(slotChanges, slot, runtime.getPartId(slot));
      removedSlots.add(slot);
    }
  }
  runtime.removeInstances([...removedSlots]);
  runtime.removeAssemblyNodes(removedNodes);

  const additions: RuntimeInstanceInput[] = [];
  for (const owner of prepared.owners) {
    if (runtime.getNodeId(owner.node) === undefined) continue;
    applyOwnerMutation({
      runtime,
      scene,
      owner,
      additions,
      slotChanges,
      resolvePartVisible,
      resolveAssemblyVisible,
    });
  }
  const slots = runtime.addInstances(additions);
  for (let index = 0; index < additions.length; index += 1) {
    const input = invariantValue(additions[index], `added hierarchy instance at ${index}`);
    const slot = invariantValue(slots[index], `added hierarchy slot at ${index}`);
    recordHierarchySlotBefore(slotChanges, slot, slotChanges.get(slot)?.beforePartId);
    recordHierarchySlotAfter(slotChanges, slot, input.partId);
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
    if (change.before?.kind === "assembly" || change.after?.kind === "assembly") {
      ids.add(change.ownerAssemblyId);
    }
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

function samePlacementMaps(
  before: ReadonlyMap<string, Placement>,
  after: ReadonlyMap<string, Placement>,
): boolean {
  if (before.size !== after.size) return false;
  for (const [id, placement] of before) if (!equalPlacement(placement, after.get(id))) return false;
  return true;
}

function hierarchyRemovalRoots(
  runtime: PackedSceneRuntime,
  owners: readonly OwnerMutation[],
): number[] {
  const roots: number[] = [];
  for (const owner of owners) {
    for (const [id, before] of owner.before) {
      const after = owner.after.get(id);
      if (before.kind !== "assembly" || equalPlacement(before, after)) continue;
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
}

function applyOwnerMutation(context: OwnerApplyContext): void {
  const {
    runtime,
    scene,
    owner,
    additions,
    slotChanges,
    resolvePartVisible,
    resolveAssemblyVisible,
  } = context;
  const ownerWorld = nodeWorld(runtime, owner.node);
  for (const [id, after] of owner.after) {
    const before = owner.before.get(id);
    if (before !== undefined && equalPlacement(before, after)) continue;
    const occurrenceId = path(owner.ownerId, id);
    const world = multiplyMatrices(ownerWorld, after.transform);
    if (after.kind === "part") {
      const slot = before?.kind === "part" ? runtime.getInstanceSlot(occurrenceId) : undefined;
      if (slot === undefined) {
        additions.push(
          instanceInput({
            scene,
            node: owner.node,
            id: occurrenceId,
            placement: after,
            world,
            resolvePartVisible,
          }),
        );
      } else {
        recordHierarchySlotBefore(slotChanges, slot, runtime.getPartId(slot));
        runtime.updateInstance(
          slot,
          instanceInput({
            scene,
            node: owner.node,
            id: occurrenceId,
            placement: after,
            world,
            resolvePartVisible,
          }),
        );
        recordHierarchySlotAfter(slotChanges, slot, after.partId);
      }
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
    });
  }
  relinkOwnerChildren(runtime, owner);
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

interface AssemblyExpansionContext {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly assemblyId: number;
  readonly nodeId: AssemblyOccurrenceId;
  readonly parent: number;
  readonly world: Mat4;
  readonly additions: RuntimeInstanceInput[];
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
  readonly resolveAssemblyVisible: (assemblyId: number, authoredVisible: boolean) => boolean;
}

function expandAssembly(context: AssemblyExpansionContext): void {
  const assembly = context.scene.assemblies.get(context.assemblyId);
  if (assembly === undefined) throw new Error(`Missing assembly ${context.assemblyId}`);
  const node = context.runtime.addAssemblyNode({
    nodeId: context.nodeId,
    assemblyId: context.assemblyId,
    parent: context.parent,
    worldTransform: context.world,
    assemblyVisible: context.resolveAssemblyVisible(
      context.assemblyId,
      context.scene.visibleAssemblyIds.has(context.assemblyId),
    ),
  });
  const children: number[] = [];
  for (const placement of assembly.placements) {
    const id = placement.placementId;
    if (id === undefined) {
      throw new Error(
        `AssemblyDefinition ${assembly.id} uses an implicit placement identity; migrate it before a live hierarchy edit`,
      );
    }
    const childId = path(context.nodeId, id);
    const world = multiplyMatrices(context.world, placement.transform);
    if (placement.kind === "part") {
      context.additions.push(
        instanceInput({
          scene: context.scene,
          node,
          id: childId,
          placement,
          world,
          resolvePartVisible: context.resolvePartVisible,
        }),
      );
      continue;
    }
    expandAssembly({
      ...context,
      assemblyId: placement.assemblyId,
      nodeId: childId,
      parent: node,
      world,
    });
    const child = context.runtime.getNodeSlot(childId);
    if (child === undefined) throw new Error(`Missing added hierarchy child ${childId}`);
    children.push(child);
  }
  context.runtime.setNodeChildren(node, children);
}

interface InstanceInputContext {
  readonly scene: Scene;
  readonly node: number;
  readonly id: PartOccurrenceId;
  readonly placement: Extract<Placement, { readonly kind: "part" }>;
  readonly world: Mat4;
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
}

function instanceInput(context: InstanceInputContext): RuntimeInstanceInput {
  const { scene, node, id, placement, world, resolvePartVisible } = context;
  return {
    instanceId: id,
    partId: placement.partId,
    owningNode: node,
    partVisible: resolvePartVisible(placement.partId, scene.visiblePartIds.has(placement.partId)),
    overrideVisible: true,
    worldTransform: world,
  };
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
