import type { PartId } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import { diffMapValues, diffNestedSetMembers, diffSetMembers } from "../interaction/mechanics";
import { readInteractionState } from "../interaction/state";
import type { InstanceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";

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
  const addInstance = (instanceId: InstanceId | undefined): void => {
    if (instanceId === undefined) {
      return;
    }
    const slot = runtime.getInstanceSlot(instanceId);
    if (slot !== undefined) {
      changed.add(slot);
    }
  };
  diffSetMembers(previousData.highlightedPartIds, nextData.highlightedPartIds, addPart);
  diffSetMembers(previousData.selectedPartIds, nextData.selectedPartIds, addPart);
  diffMapValues(previousData.partOverrides, nextData.partOverrides, addPart);
  diffSetMembers(previousData.highlightedInstanceIds, nextData.highlightedInstanceIds, addInstance);
  diffSetMembers(previousData.selectedInstanceIds, nextData.selectedInstanceIds, addInstance);
  diffMapValues(previousData.instanceOverrides, nextData.instanceOverrides, addInstance);
  diffNestedSetMembers(
    previousData.highlightedElementIds,
    nextData.highlightedElementIds,
    addInstance,
  );
  diffNestedSetMembers(previousData.hiddenElementIds, nextData.hiddenElementIds, addInstance);
  if (previousData.hoveredTarget !== nextData.hoveredTarget) {
    addInstance(hoveredInstanceId(previousData.hoveredTarget));
    addInstance(hoveredInstanceId(nextData.hoveredTarget));
  }
  return Array.from(changed).sort((a, b) => a - b);
}

function hoveredInstanceId(target: InteractionTarget | undefined): InstanceId | undefined {
  return target === undefined || target.kind === "part" ? undefined : target.instanceId;
}
