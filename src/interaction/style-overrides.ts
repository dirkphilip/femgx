import type { PartId } from "../geometry/part";
import type { PartOccurrenceId } from "../scene/types";
import {
  readInteractionState,
  updateInteractionState,
  validateStyleOverride,
  type InteractionState,
  type StyleOverride,
} from "./state";

/**
 * Applies part style overrides in one immutable state transition.
 * Duplicate ids use the last supplied value; `undefined` clears an override.
 * @category Interaction and picking
 */
export function setPartOverrides(
  state: InteractionState,
  overrides: Iterable<readonly [PartId, StyleOverride | undefined]>,
): InteractionState {
  const data = readInteractionState(state);
  const partOverrides = updatedOverrides(data.partOverrides, overrides);
  return partOverrides === data.partOverrides
    ? state
    : updateInteractionState(state, { partOverrides });
}

/**
 * Applies part-occurrence style overrides in one immutable state transition.
 * Duplicate ids use the last supplied value; `undefined` clears an override.
 * @category Interaction and picking
 */
export function setPartOccurrenceOverrides(
  state: InteractionState,
  overrides: Iterable<readonly [PartOccurrenceId, StyleOverride | undefined]>,
): InteractionState {
  const data = readInteractionState(state);
  const partOccurrenceOverrides = updatedOverrides(data.partOccurrenceOverrides, overrides);
  return partOccurrenceOverrides === data.partOccurrenceOverrides
    ? state
    : updateInteractionState(state, { partOccurrenceOverrides });
}

function updatedOverrides<Key>(
  current: ReadonlyMap<Key, StyleOverride>,
  overrides: Iterable<readonly [Key, StyleOverride | undefined]>,
): ReadonlyMap<Key, StyleOverride> {
  const requested = new Map<Key, StyleOverride | undefined>();
  for (const [key, override] of overrides) {
    validateStyleOverride(override);
    requested.set(key, override);
  }
  let next: Map<Key, StyleOverride> | undefined;
  for (const [key, override] of requested) {
    const changed = override === undefined ? current.has(key) : current.get(key) !== override;
    if (!changed) continue;
    next ??= new Map(current);
    if (override === undefined) next.delete(key);
    else next.set(key, override);
  }
  return next ?? current;
}
