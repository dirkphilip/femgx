import type { PartId } from "../geometry/part";
import { multiplyMatrices, type Mat4 } from "../math/mat4";
import type { PartPlacement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { SceneStructuralChanges } from "../scene/update-changes";
import { hasOnlyDirectPartRuntimeChanges } from "../scene/update-validation";
import type { PartOccurrenceId } from "../scene/types";
import { invariantValue } from "./invariants";
import type { PackedSceneRuntime, RuntimeInstanceInput } from "./runtime";

interface PreparedOccurrenceMutation {
  readonly slot: number | undefined;
  readonly beforePartId: PartId | undefined;
  readonly after: RuntimeInstanceInput | undefined;
}

export interface RuntimeOccurrenceSlotChange {
  readonly slot: number;
  readonly beforePartId: PartId | undefined;
  readonly afterPartId: PartId | undefined;
}

/** Exact active-slot changes produced by one direct part-placement revision. */
export interface RuntimeOccurrenceDelta {
  readonly slots: readonly RuntimeOccurrenceSlotChange[];
  readonly affectedPartIds: ReadonlySet<PartId>;
  readonly removedOccurrenceSlots: readonly number[];
  readonly addedPartIds: ReadonlySet<PartId>;
  readonly removedPartIds: ReadonlySet<PartId>;
}

export interface PreparedOccurrenceUpdate {
  readonly mutations: readonly PreparedOccurrenceMutation[];
  readonly addedPartIds: ReadonlySet<PartId>;
  readonly removedPartIds: ReadonlySet<PartId>;
}

/**
 * Expands direct part-placement edits and part-removal cascades through retained assembly nodes.
 * Assembly topology and other definition edits intentionally remain on replacement.
 */
export function prepareOccurrenceMutations(
  runtime: PackedSceneRuntime,
  scene: Scene,
  changes: SceneStructuralChanges,
  resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean = (
    _partId,
    authoredVisible,
  ) => authoredVisible,
): PreparedOccurrenceUpdate | undefined {
  if (!hasOnlyDirectPartRuntimeChanges(changes)) return undefined;
  const authored = aggregatePlacementChanges(changes);
  if (authored === undefined) return undefined;
  const mutations: PreparedOccurrenceMutation[] = [];
  for (const change of authored) {
    const owner = scene.assemblies.get(change.ownerAssemblyId);
    if (owner === undefined) return undefined;
    for (const ownerNode of runtime.getAssemblyNodeSlots(change.ownerAssemblyId)) {
      const ownerId = invariantValue(runtime.getNodeId(ownerNode), `node id at ${ownerNode}`);
      const occurrenceId = `${ownerId}/${change.placementId}` as PartOccurrenceId;
      const slot = runtime.getInstanceSlot(occurrenceId);
      if ((change.before === undefined) !== (slot === undefined)) return undefined;
      const beforePartId = slot === undefined ? undefined : runtime.getPartId(slot);
      const after =
        change.after === undefined
          ? undefined
          : instanceInput(
              { runtime, scene, ownerNode, currentSlot: slot, resolvePartVisible },
              occurrenceId,
              change.after,
            );
      if (slot !== undefined && after !== undefined && sameInstance(runtime, slot, after)) continue;
      mutations.push({ slot, beforePartId, after });
    }
  }
  return {
    mutations,
    addedPartIds: changes.parts.added,
    removedPartIds: changes.parts.removed,
  };
}

/** Applies a fully prepared direct-placement revision without recompiling the scene. */
export function applyOccurrenceMutations(
  runtime: PackedSceneRuntime,
  prepared: PreparedOccurrenceUpdate,
): RuntimeOccurrenceDelta {
  const { mutations } = prepared;
  const bySlot = new Map<number, RuntimeOccurrenceSlotChange>();
  const removedOccurrenceSlots: number[] = [];
  for (const mutation of mutations) {
    if (mutation.slot === undefined || mutation.after !== undefined) continue;
    removedOccurrenceSlots.push(mutation.slot);
    recordBefore(bySlot, mutation.slot, mutation.beforePartId);
  }
  runtime.removeInstances(removedOccurrenceSlots);
  for (const mutation of mutations) {
    if (mutation.slot === undefined || mutation.after === undefined) continue;
    recordBefore(bySlot, mutation.slot, mutation.beforePartId);
    runtime.updateInstance(mutation.slot, mutation.after);
    recordAfter(bySlot, mutation.slot, mutation.after.partId);
  }
  const additions: RuntimeInstanceInput[] = [];
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = invariantValue(mutations[index], `occurrence mutation at ${index}`);
    if (mutation.slot === undefined && mutation.after !== undefined) additions.push(mutation.after);
  }
  const addedSlots = runtime.addInstances(additions);
  for (let index = 0; index < additions.length; index += 1) {
    const addition = invariantValue(additions[index], `added occurrence at ${index}`);
    const slot = invariantValue(addedSlots[index], `added occurrence slot at ${index}`);
    recordBefore(bySlot, slot, bySlot.get(slot)?.beforePartId);
    recordAfter(bySlot, slot, addition.partId);
  }
  const slots = [...bySlot.values()].sort((left, right) => left.slot - right.slot);
  const affectedPartIds = new Set<PartId>();
  for (const change of slots) {
    if (change.beforePartId !== undefined) affectedPartIds.add(change.beforePartId);
    if (change.afterPartId !== undefined) affectedPartIds.add(change.afterPartId);
  }
  for (const partId of prepared.removedPartIds) affectedPartIds.add(partId);
  return {
    slots,
    affectedPartIds,
    removedOccurrenceSlots,
    addedPartIds: prepared.addedPartIds,
    removedPartIds: prepared.removedPartIds,
  };
}

interface AggregatedPlacementChange {
  readonly ownerAssemblyId: number;
  readonly placementId: string;
  readonly before: PartPlacement | undefined;
  after: PartPlacement | undefined;
}

function aggregatePlacementChanges(
  changes: SceneStructuralChanges,
): readonly AggregatedPlacementChange[] | undefined {
  const aggregated = new Map<string, AggregatedPlacementChange>();
  for (const change of changes.placements) {
    if (
      (change.before !== undefined && change.before.kind !== "part") ||
      (change.after !== undefined && change.after.kind !== "part")
    )
      return undefined;
    const placement = change.after ?? change.before;
    if (placement === undefined) return undefined;
    const key = `${change.ownerAssemblyId}\u0000${placement.placementId}`;
    const current = aggregated.get(key);
    if (current === undefined) {
      aggregated.set(key, {
        ownerAssemblyId: change.ownerAssemblyId,
        placementId: placement.placementId,
        before: change.before,
        after: change.after,
      });
    } else {
      current.after = change.after;
    }
  }
  return [...aggregated.values()].filter(
    ({ before, after }) => before !== undefined || after !== undefined,
  );
}

interface InstanceInputContext {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly ownerNode: number;
  readonly currentSlot: number | undefined;
  readonly resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean;
}

function instanceInput(
  context: InstanceInputContext,
  instanceId: PartOccurrenceId,
  placement: PartPlacement,
): RuntimeInstanceInput {
  const { runtime, scene, ownerNode, currentSlot, resolvePartVisible } = context;
  const ownerWorld = runtime.nodeWorldTransforms.subarray(ownerNode * 16, ownerNode * 16 + 16);
  return {
    instanceId,
    partId: placement.partId,
    owningNode: ownerNode,
    partVisible: resolvePartVisible(placement.partId, scene.visiblePartIds.has(placement.partId)),
    overrideVisible:
      currentSlot === undefined || runtime.instanceOverrideVisible[currentSlot] !== 0,
    worldTransform: multiplyMatrices(ownerWorld, placement.transform),
  };
}

function sameInstance(
  runtime: PackedSceneRuntime,
  slot: number,
  next: RuntimeInstanceInput,
): boolean {
  if (runtime.getPartId(slot) !== next.partId) return false;
  const current = runtime.getTransform(slot);
  return current !== undefined && equalMatrix(current, next.worldTransform);
}

function equalMatrix(left: Mat4, right: Mat4): boolean {
  for (let index = 0; index < 16; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function recordBefore(
  changes: Map<number, RuntimeOccurrenceSlotChange>,
  slot: number,
  partId: PartId | undefined,
): void {
  if (!changes.has(slot)) changes.set(slot, { slot, beforePartId: partId, afterPartId: undefined });
}

function recordAfter(
  changes: Map<number, RuntimeOccurrenceSlotChange>,
  slot: number,
  partId: PartId,
): void {
  const current = invariantValue(changes.get(slot), `slot change at ${slot}`);
  changes.set(slot, { ...current, afterPartId: partId });
}
