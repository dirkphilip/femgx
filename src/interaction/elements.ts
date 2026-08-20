import type { ElementId, PartOccurrenceId } from "../scene/types";
import type { ElementRef } from "../scene/types";
import { readInteractionState, updateInteractionState, type InteractionState } from "./state";
import { updateNestedSet, updateNestedSets } from "./mechanics";

/**
 * Sets one element occurrence's visibility without mutating prior state.
 * @category Interaction and picking
 */
export function setElementVisible(
  state: InteractionState,
  ref: ElementRef,
  visible: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const hiddenElementIds = updateNestedSet(
    data.hiddenElementIds,
    ref.partOccurrenceId,
    ref.elementId,
    !visible,
  );
  if (hiddenElementIds === data.hiddenElementIds) return state;
  return updateInteractionState(state, { hiddenElementIds });
}

/**
 * Sets visibility for many element occurrences in one immutable transition.
 *
 * Each occurrence's element set is cloned at most once, so broad visibility
 * operations remain linear in the requested refs instead of repeatedly copying
 * a growing nested set. Duplicate refs are harmless.
 * @category Interaction and picking
 */
export function setElementsVisible(
  state: InteractionState,
  refs: Iterable<ElementRef>,
  visible: boolean,
): InteractionState {
  const requested = new Map<PartOccurrenceId, Set<ElementId>>();
  for (const ref of refs) {
    let ids = requested.get(ref.partOccurrenceId);
    if (ids === undefined) {
      ids = new Set<ElementId>();
      requested.set(ref.partOccurrenceId, ids);
    }
    ids.add(ref.elementId);
  }
  if (requested.size === 0) return state;
  const data = readInteractionState(state);
  const hiddenElementIds = updateNestedSets(data.hiddenElementIds, requested, !visible);
  if (hiddenElementIds === data.hiddenElementIds) return state;
  return updateInteractionState(state, { hiddenElementIds });
}

/**
 * Returns whether one element occurrence is visible.
 * @category Interaction and picking
 */
export function isElementVisible(state: InteractionState, ref: ElementRef): boolean {
  return (
    readInteractionState(state).hiddenElementIds.get(ref.partOccurrenceId)?.has(ref.elementId) !==
    true
  );
}
