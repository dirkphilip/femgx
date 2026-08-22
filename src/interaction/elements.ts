import type { ElementRef } from "../scene/types";
import {
  readInteractionVisibility,
  withInteractionVisibility,
  type InteractionState,
} from "./state";
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
  const visibility = readInteractionVisibility(state);
  const hiddenElementIds = updateNestedSet(
    visibility.hiddenElementIds,
    ref.partOccurrenceId,
    ref.elementId,
    !visible,
  );
  if (hiddenElementIds === visibility.hiddenElementIds) return state;
  return withInteractionVisibility(state, { ...visibility, hiddenElementIds });
}

/**
 * Returns whether one element occurrence is visible.
 * @category Interaction and picking
 */
export function isElementVisible(state: InteractionState, ref: ElementRef): boolean {
  return (
    readInteractionVisibility(state)
      .hiddenElementIds.get(ref.partOccurrenceId)
      ?.has(ref.elementId) !== true
  );
}
