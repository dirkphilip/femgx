import type { InstanceId, PartId, Instance } from "../scene/types";

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

/** Centralized interactive state for parts and individual placements. */
export interface InteractionState {
  readonly highlightedPartIds: ReadonlySet<PartId>;
  readonly highlightedInstanceIds: ReadonlySet<InstanceId>;
  readonly selectedPartIds: ReadonlySet<PartId>;
  readonly selectedInstanceIds: ReadonlySet<InstanceId>;
  readonly hoveredInstanceId?: InstanceId;
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
