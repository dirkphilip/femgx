import type { BodyId } from "../geometry/part";
import type { InstanceId } from "../scene/types";
import type { BodyRef } from "./refs";
import type { InteractionState, StyleOverride } from "./interaction";
import {
  collectUniqueRefs,
  sameRef,
  sortedNumbers,
  updateNestedMap,
  updateNestedSet,
} from "./mechanics";

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

/** Sets the currently hovered body, or clears hover with `undefined`. */
export function setHoveredBody(
  state: InteractionState,
  ref: BodyRef | undefined,
): InteractionState {
  if (sameRef(state.hoveredBody, ref, (value) => [value.instanceId, value.bodyId])) {
    return state;
  }
  if (ref === undefined) {
    const { hoveredBody: _, ...withoutHover } = state;
    return withoutHover;
  }
  return { ...state, hoveredBody: ref };
}

/** Adds or replaces an explicit body style override. */
export function setBodyOverride(
  state: InteractionState,
  ref: BodyRef,
  override: StyleOverride | undefined,
): InteractionState {
  const bodyOverrides = updateNestedMap(state.bodyOverrides, ref.instanceId, ref.bodyId, override);
  if (bodyOverrides === state.bodyOverrides) return state;
  return { ...state, bodyOverrides };
}

/** Sets one body's visibility for one repeated part occurrence. */
export function setBodyVisible(
  state: InteractionState,
  ref: BodyRef,
  visible: boolean,
): InteractionState {
  return updateBodySet(state, "hiddenBodyIds", ref, !visible);
}

/** Returns whether a body occurrence is hidden. */
export function isBodyVisible(state: InteractionState, ref: BodyRef): boolean {
  return state.hiddenBodyIds.get(ref.instanceId)?.has(ref.bodyId) !== true;
}

/** Returns whether a body occurrence carries any visible interaction state. */
export function isBodyEmphasized(state: InteractionState, ref: BodyRef): boolean {
  return (
    state.hiddenBodyIds.get(ref.instanceId)?.has(ref.bodyId) === true ||
    state.highlightedBodyIds.get(ref.instanceId)?.has(ref.bodyId) === true ||
    state.selectedBodyIds.get(ref.instanceId)?.has(ref.bodyId) === true ||
    state.bodyOverrides.get(ref.instanceId)?.has(ref.bodyId) === true ||
    (state.hoveredBody?.instanceId === ref.instanceId && state.hoveredBody.bodyId === ref.bodyId)
  );
}

/** Collects body occurrences in stable instance/body order without duplicates. */
export function emphasizedBodyRefs(state: InteractionState): readonly BodyRef[] {
  return collectUniqueRefs(
    state.hoveredBody,
    (ref) => `${ref.instanceId}/${ref.bodyId}`,
    (push) => {
      const maps: readonly ReadonlyMap<InstanceId, BodyValues>[] = [
        state.highlightedBodyIds,
        state.selectedBodyIds,
        state.bodyOverrides,
        state.hiddenBodyIds,
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
  const next = updateNestedSet(state[key], ref.instanceId, ref.bodyId, enabled);
  if (next === state[key]) return state;
  return { ...state, [key]: next };
}

type BodyValues = { readonly keys: () => Iterable<BodyId> };

function sortedMap<V extends BodyValues>(
  map: ReadonlyMap<InstanceId, V>,
): Array<readonly [InstanceId, V]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
