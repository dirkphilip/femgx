import type { PartId } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import { diffMapValues, diffNestedSetMembers, diffSetMembers } from "../interaction/mechanics";
import { readInteractionState } from "../interaction/state";
import type { PartOccurrenceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { forEachInstanceUnderAssemblyTargets } from "../scene-runtime/interaction-hierarchy";

/**
 * Computes the instance slots whose GPU record may change when an interaction
 * state moves from `previous` to `next`, so the viewport can feed exactly
 * those slots to `WebGpuRenderer.updateInstances` instead of rescanning the
 * whole runtime. Most element-, node-, and face-level emphasis is intentionally excluded: it
 * flows through `updateElements`, which diffs its own buffers. Element
 * highlights also mark their owning slot here so consumers can observe the
 * complete interaction transition through the instance diff.
 *
 * Slots are returned in ascending order with no duplicates.
 */
export function changedInstanceSlots(
  runtime: PackedSceneRuntime,
  previous: InteractionState,
  next: InteractionState,
): number[] {
  if (previous === next) {
    return [];
  }
  const previousData = readInteractionState(previous);
  const nextData = readInteractionState(next);
  const changed = new Set<number>();
  const addPart = (partId: PartId): void => {
    const slots = runtime.getPartInstanceSlots(partId);
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      if (slot !== undefined) changed.add(slot);
    }
  };
  const addInstance = (partOccurrenceId: PartOccurrenceId | undefined): void => {
    if (partOccurrenceId === undefined) {
      return;
    }
    const slot = runtime.getInstanceSlot(partOccurrenceId);
    if (slot !== undefined) {
      changed.add(slot);
    }
  };
  addChangedAssemblySlots(runtime, previousData, nextData, changed);
  diffSetMembers(previousData.highlightedPartIds, nextData.highlightedPartIds, addPart);
  diffSetMembers(previousData.selectedPartIds, nextData.selectedPartIds, addPart);
  diffMapValues(previousData.partOverrides, nextData.partOverrides, addPart);
  diffSetMembers(
    previousData.highlightedPartOccurrenceIds,
    nextData.highlightedPartOccurrenceIds,
    addInstance,
  );
  diffSetMembers(
    previousData.selectedPartOccurrenceIds,
    nextData.selectedPartOccurrenceIds,
    addInstance,
  );
  diffMapValues(
    previousData.partOccurrenceOverrides,
    nextData.partOccurrenceOverrides,
    addInstance,
  );
  diffNestedSetMembers(
    previousData.highlightedElementIds,
    nextData.highlightedElementIds,
    addInstance,
  );
  diffNestedSetMembers(previousData.hiddenElementIds, nextData.hiddenElementIds, addInstance);
  if (previousData.hoveredTarget !== nextData.hoveredTarget) {
    addAssemblyTarget(previousData.hoveredTarget, runtime, changed);
    addAssemblyTarget(nextData.hoveredTarget, runtime, changed);
    addInstance(hoveredInstanceId(previousData.hoveredTarget));
    addInstance(hoveredInstanceId(nextData.hoveredTarget));
  }
  return Array.from(changed).sort((a, b) => a - b);
}

function addAssemblyTarget(
  target: InteractionTarget | undefined,
  runtime: PackedSceneRuntime,
  changed: Set<number>,
): void {
  if (target?.kind === "assembly") {
    addAssemblySlots(runtime, new Set([target.assemblyId]), new Set(), changed);
  } else if (target?.kind === "assemblyOccurrence") {
    addAssemblySlots(runtime, new Set(), new Set([target.assemblyOccurrenceId]), changed);
  }
}

function addChangedAssemblySlots(
  runtime: PackedSceneRuntime,
  previousData: ReturnType<typeof readInteractionState>,
  nextData: ReturnType<typeof readInteractionState>,
  changed: Set<number>,
): void {
  diffSetMembers(previousData.highlightedAssemblyIds, nextData.highlightedAssemblyIds, (id) => {
    addAssemblySlots(runtime, new Set([id]), new Set(), changed);
  });
  diffSetMembers(
    previousData.highlightedAssemblyOccurrenceIds,
    nextData.highlightedAssemblyOccurrenceIds,
    (id) => {
      addAssemblySlots(runtime, new Set(), new Set([id]), changed);
    },
  );
  diffSetMembers(previousData.selectedAssemblyIds, nextData.selectedAssemblyIds, (id) => {
    addAssemblySlots(runtime, new Set([id]), new Set(), changed);
  });
  diffSetMembers(
    previousData.selectedAssemblyOccurrenceIds,
    nextData.selectedAssemblyOccurrenceIds,
    (id) => {
      addAssemblySlots(runtime, new Set(), new Set([id]), changed);
    },
  );
}

function addAssemblySlots(
  runtime: PackedSceneRuntime,
  assemblyIds: ReadonlySet<number>,
  occurrenceIds: ReadonlySet<string>,
  changed: Set<number>,
): void {
  forEachInstanceUnderAssemblyTargets(runtime, assemblyIds, occurrenceIds, (slot) => {
    changed.add(slot);
  });
}

function hoveredInstanceId(target: InteractionTarget | undefined): PartOccurrenceId | undefined {
  return target === undefined ||
    target.kind === "part" ||
    target.kind === "assembly" ||
    target.kind === "assemblyOccurrence"
    ? undefined
    : target.partOccurrenceId;
}
