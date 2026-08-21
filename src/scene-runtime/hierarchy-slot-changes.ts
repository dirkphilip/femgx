import type { PartId } from "../geometry/part";
import { invariantValue } from "./invariants";
import type { RuntimeOccurrenceSlotChange } from "./occurrence-update";

/** Records one stable leaf slot's pre-mutation part membership once. */
export function recordHierarchySlotBefore(
  changes: Map<number, RuntimeOccurrenceSlotChange>,
  slot: number,
  partId: PartId | undefined,
): void {
  if (!changes.has(slot)) changes.set(slot, { slot, beforePartId: partId, afterPartId: undefined });
}

/** Records one stable leaf slot's final part membership. */
export function recordHierarchySlotAfter(
  changes: Map<number, RuntimeOccurrenceSlotChange>,
  slot: number,
  partId: PartId,
): void {
  const previous = invariantValue(changes.get(slot), `hierarchy slot change at ${slot}`);
  changes.set(slot, { ...previous, afterPartId: partId });
}
