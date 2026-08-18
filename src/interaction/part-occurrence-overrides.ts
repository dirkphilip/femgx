import type { PartOccurrenceId } from "../scene/types";
import {
  readInteractionState,
  updateInteractionState,
  validateStyleOverride,
  type InteractionState,
  type StyleOverride,
} from "./state";

/**
 * Applies part-occurrence style overrides in one immutable state transition.
 * Duplicate ids use the last supplied value; `undefined` clears an override.
 * @category Interaction and picking
 */
export function setPartOccurrenceOverrides(
  state: InteractionState,
  overrides: Iterable<readonly [PartOccurrenceId, StyleOverride | undefined]>,
): InteractionState {
  const requested = new Map<PartOccurrenceId, StyleOverride | undefined>();
  for (const [partOccurrenceId, override] of overrides) {
    validateStyleOverride(override);
    requested.set(partOccurrenceId, override);
  }
  const data = readInteractionState(state);
  let changed = false;
  for (const [partOccurrenceId, override] of requested) {
    if (
      (override === undefined && data.partOccurrenceOverrides.has(partOccurrenceId)) ||
      (override !== undefined && data.partOccurrenceOverrides.get(partOccurrenceId) !== override)
    ) {
      changed = true;
      break;
    }
  }
  if (!changed) return state;
  const partOccurrenceOverrides = new Map(data.partOccurrenceOverrides);
  for (const [partOccurrenceId, override] of requested) {
    if (override === undefined) partOccurrenceOverrides.delete(partOccurrenceId);
    else partOccurrenceOverrides.set(partOccurrenceId, override);
  }
  return updateInteractionState(state, { partOccurrenceOverrides });
}
