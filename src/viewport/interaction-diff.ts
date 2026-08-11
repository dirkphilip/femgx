import type { PartId } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { InstanceId } from "../scene/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";

/**
 * Computes the instance slots whose GPU record may change when an interaction
 * state moves from `previous` to `next`, so the viewport can feed exactly
 * those slots to `WebGpuRenderer.updateInstances` instead of rescanning the
 * whole runtime. Body-, element-, node-, and face-level emphasis is
 * intentionally excluded: it flows through `updateElements`, which diffs its
 * own buffers.
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
  diffSetMembers(previous.highlightedPartIds, next.highlightedPartIds, addPart);
  diffSetMembers(previous.selectedPartIds, next.selectedPartIds, addPart);
  diffOverrideKeys(previous.partOverrides, next.partOverrides, addPart);
  diffSetMembers(previous.highlightedInstanceIds, next.highlightedInstanceIds, addInstance);
  diffSetMembers(previous.selectedInstanceIds, next.selectedInstanceIds, addInstance);
  diffOverrideKeys(previous.instanceOverrides, next.instanceOverrides, addInstance);
  if (previous.hoveredInstanceId !== next.hoveredInstanceId) {
    addInstance(previous.hoveredInstanceId);
    addInstance(next.hoveredInstanceId);
  }
  return Array.from(changed).sort((a, b) => a - b);
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
