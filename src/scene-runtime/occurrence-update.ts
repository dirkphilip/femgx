import type { PartId } from "../geometry/part";
import { multiply, type Mat4 } from "../math/mat4";
import type { PartPlacement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import { hasDefinitionChanges, type SceneStructuralChanges } from "../scene/update-changes";
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
}

/**
 * Expands only direct part-placement edits through retained assembly nodes.
 * Assembly topology and definition edits intentionally remain on replacement.
 */
export function prepareOccurrenceMutations(
  runtime: PackedSceneRuntime,
  scene: Scene,
  changes: SceneStructuralChanges,
  resolvePartVisible: (partId: PartId, authoredVisible: boolean) => boolean = (
    _partId,
    authoredVisible,
  ) => authoredVisible,
): readonly PreparedOccurrenceMutation[] | undefined {
  if (
    hasDefinitionChanges(changes.parts) ||
    hasDefinitionChanges(changes.assemblies) ||
    changes.placements.length === 0
  )
    return undefined;
  const authored = aggregatePlacementChanges(changes);
  if (authored === undefined) return undefined;
  const mutations: PreparedOccurrenceMutation[] = [];
  for (const change of authored) {
    const owner = scene.assemblies.get(change.ownerAssemblyId);
    if (
      (change.before === undefined || change.after === undefined) &&
      owner?.placements.some(({ placementId }) => placementId === undefined)
    )
      return undefined;
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
  return mutations.length === 0 ? undefined : mutations;
}

/** Applies a fully prepared direct-placement revision without recompiling the scene. */
export function applyOccurrenceMutations(
  runtime: PackedSceneRuntime,
  mutations: readonly PreparedOccurrenceMutation[],
): RuntimeOccurrenceDelta {
  const bySlot = new Map<number, RuntimeOccurrenceSlotChange>();
  const removedOccurrenceSlots: number[] = [];
  for (const mutation of mutations) {
    if (mutation.slot === undefined || mutation.after !== undefined) continue;
    removedOccurrenceSlots.push(mutation.slot);
    recordBefore(bySlot, mutation.slot, mutation.beforePartId);
    runtime.removeInstance(mutation.slot);
  }
  for (const mutation of mutations) {
    if (mutation.slot === undefined || mutation.after === undefined) continue;
    recordBefore(bySlot, mutation.slot, mutation.beforePartId);
    runtime.updateInstance(mutation.slot, mutation.after);
    recordAfter(bySlot, mutation.slot, mutation.after.partId);
  }
  for (const mutation of mutations) {
    if (mutation.slot !== undefined || mutation.after === undefined) continue;
    const slot = runtime.addInstance(mutation.after);
    recordBefore(bySlot, slot, bySlot.get(slot)?.beforePartId);
    recordAfter(bySlot, slot, mutation.after.partId);
  }
  const slots = [...bySlot.values()].sort((left, right) => left.slot - right.slot);
  const affectedPartIds = new Set<PartId>();
  for (const change of slots) {
    if (change.beforePartId !== undefined) affectedPartIds.add(change.beforePartId);
    if (change.afterPartId !== undefined) affectedPartIds.add(change.afterPartId);
  }
  return { slots, affectedPartIds, removedOccurrenceSlots };
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
      (change.before !== undefined &&
        (change.before.kind !== "part" || change.before.placementId === undefined)) ||
      (change.after !== undefined &&
        (change.after.kind !== "part" || change.after.placementId === undefined))
    )
      return undefined;
    const placement = change.after ?? change.before;
    if (placement === undefined || placement.placementId === undefined) return undefined;
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
    worldTransform: multiply(ownerWorld, placement.transform),
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
