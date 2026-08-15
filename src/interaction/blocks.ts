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
import type { ElementBlockRef } from "./refs";

/**
 * Sets or clears one element-block selection without mutating prior state.
 * @category Interaction and picking
 */
export function setElementBlockSelected(
  state: InteractionState,
  ref: ElementBlockRef,
  selected: boolean,
): InteractionState {
  const data = readInteractionState(state);
  return updateNestedState({
    state,
    current: data.selectedBlockIds,
    outerKey: ref.instanceId,
    innerKey: ref.blockId,
    enabled: selected,
    replace: (next) => updateInteractionState(state, { selectedBlockIds: next }),
  });
}

/**
 * Sets or clears one element-block highlight without mutating prior state.
 * @category Interaction and picking
 */
export function setElementBlockHighlighted(
  state: InteractionState,
  ref: ElementBlockRef,
  highlighted: boolean,
): InteractionState {
  const data = readInteractionState(state);
  return updateNestedState({
    state,
    current: data.highlightedBlockIds,
    outerKey: ref.instanceId,
    innerKey: ref.blockId,
    enabled: highlighted,
    replace: (next) => updateInteractionState(state, { highlightedBlockIds: next }),
  });
}

/**
 * Sets one element block's visibility for one repeated part occurrence.
 * @category Interaction and picking
 */
export function setElementBlockVisible(
  state: InteractionState,
  ref: ElementBlockRef,
  visible: boolean,
): InteractionState {
  const data = readInteractionState(state);
  return updateNestedState({
    state,
    current: data.hiddenBlockIds,
    outerKey: ref.instanceId,
    innerKey: ref.blockId,
    enabled: !visible,
    replace: (next) => updateInteractionState(state, { hiddenBlockIds: next }),
  });
}

/**
 * Returns whether an element block occurrence is visible.
 * @category Interaction and picking
 */
export function isElementBlockVisible(state: InteractionState, ref: ElementBlockRef): boolean {
  return isNestedValueVisible(
    readInteractionState(state).hiddenBlockIds,
    ref.instanceId,
    ref.blockId,
  );
}

/**
 * Adds or replaces an explicit element-block style override.
 * @category Interaction and picking
 */
export function setElementBlockOverride(
  state: InteractionState,
  ref: ElementBlockRef,
  override: PrimitiveStyleOverride | undefined,
): InteractionState {
  validatePrimitiveStyleOverride(override);
  const data = readInteractionState(state);
  const blockOverrides = updateNestedMap(
    data.blockOverrides,
    ref.instanceId,
    ref.blockId,
    override,
  );
  if (blockOverrides === data.blockOverrides) return state;
  return updateInteractionState(state, { blockOverrides });
}

/**
 * Returns whether an element block occurrence carries any interaction state.
 * @category Interaction and picking
 */
export function isElementBlockEmphasized(state: InteractionState, ref: ElementBlockRef): boolean {
  const data = readInteractionState(state);
  return isNestedValueEmphasized({
    hidden: data.hiddenBlockIds,
    highlighted: data.highlightedBlockIds,
    selected: data.selectedBlockIds,
    overrides: data.blockOverrides,
    hovered: isHoveredTarget(state, { kind: "block", ...ref }),
    outerKey: ref.instanceId,
    innerKey: ref.blockId,
  });
}

/**
 * Collects emphasized block occurrences in stable instance/block order.
 * @category Interaction and picking
 */
export function emphasizedElementBlockRefs(state: InteractionState): readonly ElementBlockRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "block"
      ? { instanceId: data.hoveredTarget.instanceId, blockId: data.hoveredTarget.blockId }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.blockId}`,
    (push) => {
      appendSortedNestedRefs(
        [data.highlightedBlockIds, data.selectedBlockIds, data.hiddenBlockIds, data.blockOverrides],
        (instanceId, blockId) => {
          push({ instanceId, blockId });
        },
      );
    },
  );
}
