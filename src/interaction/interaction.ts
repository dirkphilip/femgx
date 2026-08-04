import type { ElementId, ElementRef, InstanceId, PartId, Instance } from "../scene/types";

/** RGBA color with normalized channels. */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Partial per-instance style written into the GPU instance buffer. */
export interface StyleOverride {
  readonly color?: Color;
  readonly emissive?: number;
  readonly opacity?: number;
}

/** Complete style consumed by a renderer. */
export interface ResolvedStyle {
  readonly color: Color;
  readonly emissive: number;
  readonly opacity: number;
}

/** Visual defaults for interaction states. */
export interface InteractionTheme {
  readonly highlighted: StyleOverride;
  readonly selected: StyleOverride;
  readonly hovered: StyleOverride;
}

/** Centralized interactive state for parts, placements, and finite elements. */
export interface InteractionState {
  readonly highlightedPartIds: ReadonlySet<PartId>;
  readonly highlightedInstanceIds: ReadonlySet<InstanceId>;
  readonly selectedPartIds: ReadonlySet<PartId>;
  readonly selectedInstanceIds: ReadonlySet<InstanceId>;
  readonly hoveredInstanceId?: InstanceId;
  readonly selectedElementIds: ReadonlyMap<InstanceId, ReadonlySet<ElementId>>;
  readonly hoveredElement?: ElementRef;
  readonly elementOverrides: ReadonlyMap<InstanceId, ReadonlyMap<ElementId, StyleOverride>>;
  readonly partOverrides: ReadonlyMap<PartId, StyleOverride>;
  readonly instanceOverrides: ReadonlyMap<InstanceId, StyleOverride>;
  readonly theme: InteractionTheme;
}

const defaultTheme: InteractionTheme = {
  highlighted: { emissive: 0.35 },
  selected: { color: { r: 1, g: 0.75, b: 0.1, a: 1 }, emissive: 0.6 },
  hovered: { emissive: 0.2 },
};

/** Creates an empty interaction state. */
export function createInteractionState(theme: InteractionTheme = defaultTheme): InteractionState {
  return {
    highlightedPartIds: new Set(),
    highlightedInstanceIds: new Set(),
    selectedPartIds: new Set(),
    selectedInstanceIds: new Set(),
    selectedElementIds: new Map(),
    elementOverrides: new Map(),
    partOverrides: new Map(),
    instanceOverrides: new Map(),
    theme,
  };
}

/** Sets or clears a part highlight without mutating the previous state. */
export function setPartHighlighted(
  state: InteractionState,
  partId: PartId,
  highlighted: boolean,
): InteractionState {
  return updatePartSet(state, "highlightedPartIds", partId, highlighted);
}

/** Sets or clears an instance highlight without mutating the previous state. */
export function setInstanceHighlighted(
  state: InteractionState,
  instanceId: InstanceId,
  highlighted: boolean,
): InteractionState {
  return updateInstanceSet(state, "highlightedInstanceIds", instanceId, highlighted);
}

/** Sets or clears a part selection without mutating the previous state. */
export function setPartSelected(
  state: InteractionState,
  partId: PartId,
  selected: boolean,
): InteractionState {
  return updatePartSet(state, "selectedPartIds", partId, selected);
}

/** Sets or clears an instance selection without mutating the previous state. */
export function setInstanceSelected(
  state: InteractionState,
  instanceId: InstanceId,
  selected: boolean,
): InteractionState {
  return updateInstanceSet(state, "selectedInstanceIds", instanceId, selected);
}

/** Sets the currently hovered instance, or clears hover with `undefined`. */
export function setHoveredInstance(
  state: InteractionState,
  instanceId: InstanceId | undefined,
): InteractionState {
  if (state.hoveredInstanceId === instanceId) {
    return state;
  }
  if (instanceId === undefined) {
    const { hoveredInstanceId: _, ...withoutHover } = state;
    return withoutHover;
  }
  return { ...state, hoveredInstanceId: instanceId };
}

/** Sets or clears an element selection without mutating the previous state. */
export function setElementSelected(
  state: InteractionState,
  ref: ElementRef,
  selected: boolean,
): InteractionState {
  const current = state.selectedElementIds.get(ref.instanceId);
  const has = current?.has(ref.elementId) ?? false;
  if (has === selected) return state;
  const ids = new Set(current ?? []);
  if (selected) ids.add(ref.elementId);
  else ids.delete(ref.elementId);
  const selectedElementIds = new Map(state.selectedElementIds);
  if (ids.size === 0) selectedElementIds.delete(ref.instanceId);
  else selectedElementIds.set(ref.instanceId, ids);
  return { ...state, selectedElementIds };
}

/** Sets the currently hovered element, or clears hover with `undefined`. */
export function setHoveredElement(
  state: InteractionState,
  ref: ElementRef | undefined,
): InteractionState {
  const current = state.hoveredElement;
  if (current === ref) return state;
  if (
    current !== undefined &&
    ref !== undefined &&
    current.instanceId === ref.instanceId &&
    current.elementId === ref.elementId
  ) {
    return state;
  }
  if (ref === undefined) {
    const { hoveredElement: _, ...withoutHover } = state;
    return withoutHover;
  }
  return { ...state, hoveredElement: ref };
}

/** Adds or replaces an explicit element style override. */
export function setElementOverride(
  state: InteractionState,
  ref: ElementRef,
  override: StyleOverride | undefined,
): InteractionState {
  const current = state.elementOverrides.get(ref.instanceId)?.get(ref.elementId);
  if (current === override) return state;
  const instanceOverrides = new Map(state.elementOverrides.get(ref.instanceId) ?? []);
  if (override === undefined) instanceOverrides.delete(ref.elementId);
  else instanceOverrides.set(ref.elementId, override);
  const elementOverrides = new Map(state.elementOverrides);
  if (instanceOverrides.size === 0) elementOverrides.delete(ref.instanceId);
  else elementOverrides.set(ref.instanceId, instanceOverrides);
  return { ...state, elementOverrides };
}

/** Adds or replaces an explicit part style override. */
export function setPartOverride(
  state: InteractionState,
  partId: PartId,
  override: StyleOverride | undefined,
): InteractionState {
  return updatePartOverride(state, partId, override);
}

/** Adds or replaces an explicit instance style override. */
export function setInstanceOverride(
  state: InteractionState,
  instanceId: InstanceId,
  override: StyleOverride | undefined,
): InteractionState {
  return updateInstanceOverride(state, instanceId, override);
}

/** Resolves all active state into one renderer-ready style. */
export function resolveInstanceStyle(
  instance: Instance,
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const overrides: StyleOverride[] = [];
  if (state.highlightedPartIds.has(instance.partId)) overrides.push(state.theme.highlighted);
  if (state.highlightedInstanceIds.has(instance.instanceId))
    overrides.push(state.theme.highlighted);
  if (state.hoveredInstanceId === instance.instanceId) overrides.push(state.theme.hovered);
  if (state.selectedPartIds.has(instance.partId)) overrides.push(state.theme.selected);
  if (state.selectedInstanceIds.has(instance.instanceId)) overrides.push(state.theme.selected);
  const partOverride = state.partOverrides.get(instance.partId);
  if (partOverride !== undefined) overrides.push(partOverride);
  const instanceOverride = state.instanceOverrides.get(instance.instanceId);
  if (instanceOverride !== undefined) overrides.push(instanceOverride);
  return overrides.reduce<ResolvedStyle>((style, override) => ({ ...style, ...override }), base);
}

/**
 * Resolves the style of one element occurrence. Element-level state is more
 * specific than part/instance state, so element hover, element selection, and
 * explicit element overrides win over `resolveInstanceStyle` results. Within
 * the element level, selection beats hover and explicit overrides win last.
 */
export function resolveElementStyle(
  instance: Instance,
  elementId: ElementId,
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  let style = resolveInstanceStyle(instance, base, state);
  const hovered = state.hoveredElement;
  if (
    hovered !== undefined &&
    hovered.instanceId === instance.instanceId &&
    hovered.elementId === elementId
  ) {
    style = { ...style, ...state.theme.hovered };
  }
  if (state.selectedElementIds.get(instance.instanceId)?.has(elementId) === true) {
    style = { ...style, ...state.theme.selected };
  }
  const override = state.elementOverrides.get(instance.instanceId)?.get(elementId);
  if (override !== undefined) style = { ...style, ...override };
  return style;
}

/**
 * Collects every element occurrence that currently carries element-level
 * emphasis (hovered, selected, or explicitly overridden), in deterministic
 * order with no duplicates.
 */
export function emphasizedElementRefs(state: InteractionState): readonly ElementRef[] {
  const refs: ElementRef[] = [];
  const seen = new Set<string>();
  const push = (instanceId: InstanceId, elementId: ElementId): void => {
    const key = `${instanceId}/${elementId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ instanceId, elementId });
  };
  const hovered = state.hoveredElement;
  if (hovered !== undefined) push(hovered.instanceId, hovered.elementId);
  for (const [instanceId, ids] of state.selectedElementIds) {
    for (const elementId of sortedNumbers(ids)) push(instanceId, elementId);
  }
  for (const [instanceId, overrides] of state.elementOverrides) {
    for (const elementId of sortedNumbers(overrides.keys())) push(instanceId, elementId);
  }
  return refs;
}

function sortedNumbers(values: Iterable<ElementId>): number[] {
  return Array.from(values).sort((a, b) => a - b);
}

function updatePartSet(
  state: InteractionState,
  key: "highlightedPartIds" | "selectedPartIds",
  value: PartId,
  enabled: boolean,
): InteractionState {
  const current = state[key];
  if (current.has(value) === enabled) return state;
  const next = new Set(current);
  if (enabled) next.add(value);
  else next.delete(value);
  return { ...state, [key]: next };
}

function updateInstanceSet(
  state: InteractionState,
  key: "highlightedInstanceIds" | "selectedInstanceIds",
  value: InstanceId,
  enabled: boolean,
): InteractionState {
  const current = state[key];
  if (current.has(value) === enabled) return state;
  const next = new Set(current);
  if (enabled) next.add(value);
  else next.delete(value);
  return { ...state, [key]: next };
}

function updatePartOverride(
  state: InteractionState,
  value: PartId,
  override: StyleOverride | undefined,
): InteractionState {
  const current = state.partOverrides;
  if (current.get(value) === override) return state;
  const next = new Map(current);
  if (override === undefined) next.delete(value);
  else next.set(value, override);
  return { ...state, partOverrides: next };
}

function updateInstanceOverride(
  state: InteractionState,
  value: InstanceId,
  override: StyleOverride | undefined,
): InteractionState {
  const current = state.instanceOverrides;
  if (current.get(value) === override) return state;
  const next = new Map(current);
  if (override === undefined) next.delete(value);
  else next.set(value, override);
  return { ...state, instanceOverrides: next };
}
