import type { BodyId } from "../geometry/part";
import type { InstanceId } from "../scene/types";
import type { BodyRef } from "./refs";
import type { InteractionState, StyleOverride } from "./interaction";

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
  const current = state.hoveredBody;
  if (current?.instanceId === ref?.instanceId && current?.bodyId === ref?.bodyId) {
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
  const current = state.bodyOverrides.get(ref.instanceId)?.get(ref.bodyId);
  if (current === override) return state;
  const overrides = new Map(state.bodyOverrides.get(ref.instanceId) ?? []);
  if (override === undefined) overrides.delete(ref.bodyId);
  else overrides.set(ref.bodyId, override);
  const bodyOverrides = new Map(state.bodyOverrides);
  if (overrides.size === 0) bodyOverrides.delete(ref.instanceId);
  else bodyOverrides.set(ref.instanceId, overrides);
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
  const refs: BodyRef[] = [];
  const seen = new Set<string>();
  const push = (instanceId: InstanceId, bodyId: BodyId): void => {
    const key = `${instanceId}/${bodyId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ instanceId, bodyId });
  };
  const hovered = state.hoveredBody;
  if (hovered !== undefined) push(hovered.instanceId, hovered.bodyId);
  const maps: readonly ReadonlyMap<InstanceId, BodyValues>[] = [
    state.highlightedBodyIds,
    state.selectedBodyIds,
    state.bodyOverrides,
    state.hiddenBodyIds,
  ];
  for (const map of maps) {
    for (const [instanceId, values] of sortedMap(map)) {
      for (const bodyId of sortedNumbers(values.keys())) push(instanceId, bodyId);
    }
  }
  return refs;
}

function updateBodySet(
  state: InteractionState,
  key: "selectedBodyIds" | "highlightedBodyIds" | "hiddenBodyIds",
  ref: BodyRef,
  enabled: boolean,
): InteractionState {
  const current = state[key].get(ref.instanceId);
  const has = current?.has(ref.bodyId) ?? false;
  if (has === enabled) return state;
  const ids = new Set(current ?? []);
  if (enabled) ids.add(ref.bodyId);
  else ids.delete(ref.bodyId);
  const next = new Map(state[key]);
  if (ids.size === 0) next.delete(ref.instanceId);
  else next.set(ref.instanceId, ids);
  return { ...state, [key]: next };
}

type BodyValues = { readonly keys: () => Iterable<BodyId> };

function sortedMap<V extends BodyValues>(
  map: ReadonlyMap<InstanceId, V>,
): Array<readonly [InstanceId, V]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function sortedNumbers(values: Iterable<BodyId>): number[] {
  return [...values].sort((a, b) => a - b);
}
