import type { BodyId } from "../geometry/part";
import type { InstanceId } from "../scene/types";
import type { BodyRef } from "./refs";
import {
  isHoveredTarget,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type PrimitiveStyleOverride,
  validatePrimitiveStyleOverride,
} from "./state";
import { collectUniqueRefs, sortedNumbers, updateNestedMap, updateNestedSet } from "./mechanics";

/** Sets or clears one body selection without mutating the previous state. */
export function setBodySelected(
  state: InteractionState,
  ref: BodyRef,
  selected: boolean,
): InteractionState {
  return updateBodySet(state, "selectedBodyIds", ref, selected);
}

/** Sets or clears one body highlight without mutating the previous state. */
export function setBodyHighlighted(
  state: InteractionState,
  ref: BodyRef,
  highlighted: boolean,
): InteractionState {
  return updateBodySet(state, "highlightedBodyIds", ref, highlighted);
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
  return updateBodySet(state, "hiddenBodyIds", ref, !visible);
}

/**
 * Returns whether a body occurrence is hidden.
 * @category Interaction and picking
 */
export function isBodyVisible(state: InteractionState, ref: BodyRef): boolean {
  return readInteractionState(state).hiddenBodyIds.get(ref.instanceId)?.has(ref.bodyId) !== true;
}

/**
 * Returns whether a body occurrence carries any visible interaction state.
 * @category Interaction and picking
 */
export function isBodyEmphasized(state: InteractionState, ref: BodyRef): boolean {
  const data = readInteractionState(state);
  return (
    data.hiddenBodyIds.get(ref.instanceId)?.has(ref.bodyId) === true ||
    data.highlightedBodyIds.get(ref.instanceId)?.has(ref.bodyId) === true ||
    data.selectedBodyIds.get(ref.instanceId)?.has(ref.bodyId) === true ||
    data.bodyOverrides.get(ref.instanceId)?.has(ref.bodyId) === true ||
    isHoveredTarget(state, { kind: "body", ...ref })
  );
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
      const maps: readonly ReadonlyMap<InstanceId, BodyValues>[] = [
        data.highlightedBodyIds,
        data.selectedBodyIds,
        data.bodyOverrides,
        data.hiddenBodyIds,
      ];
      for (const map of maps) {
        for (const [instanceId, values] of sortedMap(map)) {
          for (const bodyId of sortedNumbers(values.keys())) push({ instanceId, bodyId });
        }
      }
    },
  );
}

function updateBodySet(
  state: InteractionState,
  key: "selectedBodyIds" | "highlightedBodyIds" | "hiddenBodyIds",
  ref: BodyRef,
  enabled: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const next = updateNestedSet(data[key], ref.instanceId, ref.bodyId, enabled);
  if (next === data[key]) return state;
  return updateInteractionState(state, { [key]: next });
}

type BodyValues = { readonly keys: () => Iterable<BodyId> };

function sortedMap<V extends BodyValues>(
  map: ReadonlyMap<InstanceId, V>,
): Array<readonly [InstanceId, V]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
