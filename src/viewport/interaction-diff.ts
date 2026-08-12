import type { PartId } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import { readInteractionState } from "../interaction/state";
import type { InstanceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";

/**
 * Computes the instance slots whose GPU record may change when an interaction
 * state moves from `previous` to `next`, so the viewport can feed exactly
 * those slots to `WebGpuRenderer.updateInstances` instead of rescanning the
 * whole runtime. Body-, element-, node-, and face-level emphasis is
 * Most element-, node-, and face-level emphasis is intentionally excluded: it
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
  const slotByInstanceId = new Map<InstanceId, number>();
  const slotsByPartId = new Map<PartId, number[]>();
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    const instanceId = runtime.getInstanceId(slot);
    if (instanceId !== undefined) {
      slotByInstanceId.set(instanceId, slot);
    }
    const partId = runtime.instancePartIds[slot];
    if (partId === undefined) {
      continue;
    }
    let partSlots = slotsByPartId.get(partId);
    if (partSlots === undefined) {
      partSlots = [];
      slotsByPartId.set(partId, partSlots);
    }
    partSlots.push(slot);
  }
  const changed = new Set<number>();
  const addPart = (partId: PartId): void => {
    for (const slot of slotsByPartId.get(partId) ?? []) {
      changed.add(slot);
    }
  };
  const addInstance = (instanceId: InstanceId | undefined): void => {
    if (instanceId === undefined) {
      return;
    }
    const slot = slotByInstanceId.get(instanceId);
    if (slot !== undefined) {
      changed.add(slot);
    }
  };
  diffSetMembers(previousData.highlightedPartIds, nextData.highlightedPartIds, addPart);
  diffSetMembers(previousData.selectedPartIds, nextData.selectedPartIds, addPart);
  diffOverrideKeys(previousData.partOverrides, nextData.partOverrides, addPart);
  diffSetMembers(previousData.highlightedInstanceIds, nextData.highlightedInstanceIds, addInstance);
  diffSetMembers(previousData.selectedInstanceIds, nextData.selectedInstanceIds, addInstance);
  diffOverrideKeys(previousData.instanceOverrides, nextData.instanceOverrides, addInstance);
  diffNestedSetMembers(
    previousData.highlightedElementIds,
    nextData.highlightedElementIds,
    addInstance,
  );
  if (previousData.hoveredTarget !== nextData.hoveredTarget) {
    addInstance(hoveredInstanceId(previousData.hoveredTarget));
    addInstance(hoveredInstanceId(nextData.hoveredTarget));
  }
  return Array.from(changed).sort((a, b) => a - b);
}

function hoveredInstanceId(target: InteractionTarget | undefined): InstanceId | undefined {
  return target === undefined || target.kind === "part" ? undefined : target.instanceId;
}

function diffNestedSetMembers<OuterKey, InnerKey>(
  previous: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  next: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  visit: (value: OuterKey) => void,
): void {
  for (const [outerKey, values] of previous) {
    const nextValues = next.get(outerKey);
    if (nextValues === undefined || [...values].some((value) => !nextValues.has(value))) {
      visit(outerKey);
    }
  }
  for (const [outerKey, values] of next) {
    const previousValues = previous.get(outerKey);
    if (previousValues === undefined || [...values].some((value) => !previousValues.has(value))) {
      visit(outerKey);
    }
  }
}

function diffSetMembers<T>(
  previous: ReadonlySet<T>,
  next: ReadonlySet<T>,
  visit: (value: T) => void,
): void {
  for (const value of previous) {
    if (!next.has(value)) {
      visit(value);
    }
  }
  for (const value of next) {
    if (!previous.has(value)) {
      visit(value);
    }
  }
}

function diffOverrideKeys<K, V>(
  previous: ReadonlyMap<K, V>,
  next: ReadonlyMap<K, V>,
  visit: (key: K) => void,
): void {
  for (const [key, value] of previous) {
    if (next.get(key) !== value) {
      visit(key);
    }
  }
  for (const [key, value] of next) {
    if (previous.get(key) !== value) {
      visit(key);
    }
  }
}
