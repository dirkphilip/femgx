import type { BodyRef } from "./refs";
import {
  isHoveredTarget,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type PrimitiveStyleOverride,
  validatePrimitiveStyleOverride,
} from "./state";
import {
  appendSortedNestedRefs,
  collectUniqueRefs,
  isNestedValueEmphasized,
  isNestedValueVisible,
  updateNestedMap,
  updateNestedState,
} from "./mechanics";

/** Sets or clears one body selection without mutating the previous state. */
export function setBodySelected(
  state: InteractionState,
  ref: BodyRef,
  selected: boolean,
): InteractionState {
  const data = readInteractionState(state);
  return updateNestedState({
    state,
    current: data.selectedBodyIds,
    outerKey: ref.instanceId,
    innerKey: ref.bodyId,
    enabled: selected,
    replace: (next) => updateInteractionState(state, { selectedBodyIds: next }),
  });
}

/** Sets or clears one body highlight without mutating the previous state. */
export function setBodyHighlighted(
  state: InteractionState,
  ref: BodyRef,
  highlighted: boolean,
): InteractionState {
  const data = readInteractionState(state);
  return updateNestedState({
    state,
    current: data.highlightedBodyIds,
    outerKey: ref.instanceId,
    innerKey: ref.bodyId,
    enabled: highlighted,
    replace: (next) => updateInteractionState(state, { highlightedBodyIds: next }),
  });
}

/**
 * Adds or replaces an explicit body style override.
 * @category Interaction and picking
 */
export function setBodyOverride(
  state: InteractionState,
  ref: BodyRef,
  override: PrimitiveStyleOverride | undefined,
): InteractionState {
  validatePrimitiveStyleOverride(override);
  const data = readInteractionState(state);
  const bodyOverrides = updateNestedMap(data.bodyOverrides, ref.instanceId, ref.bodyId, override);
  if (bodyOverrides === data.bodyOverrides) return state;
  return updateInteractionState(state, { bodyOverrides });
}

/**
 * Sets one body's visibility for one repeated part occurrence.
 * @category Interaction and picking
 */
export function setBodyVisible(
  state: InteractionState,
  ref: BodyRef,
  visible: boolean,
): InteractionState {
  const data = readInteractionState(state);
  return updateNestedState({
    state,
    current: data.hiddenBodyIds,
    outerKey: ref.instanceId,
    innerKey: ref.bodyId,
    enabled: !visible,
    replace: (next) => updateInteractionState(state, { hiddenBodyIds: next }),
  });
}

/**
 * Returns whether a body occurrence is hidden.
 * @category Interaction and picking
 */
export function isBodyVisible(state: InteractionState, ref: BodyRef): boolean {
  return isNestedValueVisible(
    readInteractionState(state).hiddenBodyIds,
    ref.instanceId,
    ref.bodyId,
  );
}

/**
 * Returns whether a body occurrence carries any visible interaction state.
 * @category Interaction and picking
 */
export function isBodyEmphasized(state: InteractionState, ref: BodyRef): boolean {
  const data = readInteractionState(state);
  return isNestedValueEmphasized({
    hidden: data.hiddenBodyIds,
    highlighted: data.highlightedBodyIds,
    selected: data.selectedBodyIds,
    overrides: data.bodyOverrides,
    hovered: isHoveredTarget(state, { kind: "body", ...ref }),
    outerKey: ref.instanceId,
    innerKey: ref.bodyId,
  });
}

/**
 * Collects body occurrences in stable instance/body order without duplicates.
 * @category Interaction and picking
 */
export function emphasizedBodyRefs(state: InteractionState): readonly BodyRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "body"
      ? { instanceId: data.hoveredTarget.instanceId, bodyId: data.hoveredTarget.bodyId }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.bodyId}`,
    (push) => {
      appendSortedNestedRefs(
        [data.highlightedBodyIds, data.selectedBodyIds, data.bodyOverrides, data.hiddenBodyIds],
        (instanceId, bodyId) => {
          push({ instanceId, bodyId });
        },
      );
    },
  );
}
