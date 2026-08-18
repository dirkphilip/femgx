import type { ElementRef } from "../scene/types";
import { readInteractionState, updateInteractionState, type InteractionState } from "./state";
import { updateNestedSet } from "./mechanics";

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
 * Returns whether one element occurrence is visible.
 * @category Interaction and picking
 */
export function isElementVisible(state: InteractionState, ref: ElementRef): boolean {
  return (
    readInteractionState(state).hiddenElementIds.get(ref.partOccurrenceId)?.has(ref.elementId) !==
    true
  );
}
