import type { ElementId, ElementRef, InstanceId, Instance } from "../scene/types";
import type { NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import type { BodyId, PartId } from "../geometry/part";
import type { BodyRef, FaceRef, NodeRef } from "./refs";
import {
  applyStyleLayers,
  collectUniqueRefs,
  sameRef,
  sortedNumbers,
  updateMapValue,
  updateNestedMap,
  updateNestedSet,
  updateSet,
} from "./mechanics";

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
  /** Whether the instance's mesh edges are overlaid as lines on its surface. */
  readonly edge?: boolean;
}

/** Complete style consumed by a renderer. */
export interface ResolvedStyle {
  readonly color: Color;
  readonly emissive: number;
  readonly opacity: number;
  /** Whether the instance's mesh edges are overlaid as lines on its surface. */
  readonly edge: boolean;
}

/** Visual defaults for interaction states. */
export interface InteractionTheme {
  readonly highlighted: StyleOverride;
  readonly selected: StyleOverride;
  readonly hovered: StyleOverride;
  readonly hoveredFace: StyleOverride;
  readonly selectedFace: StyleOverride;
  readonly hoveredNode: StyleOverride;
  readonly selectedNode: StyleOverride;
}

/** Centralized interactive state for parts, placements, and finite elements. */
export interface InteractionState {
  readonly highlightedPartIds: ReadonlySet<PartId>;
  readonly highlightedInstanceIds: ReadonlySet<InstanceId>;
  readonly selectedPartIds: ReadonlySet<PartId>;
  readonly selectedInstanceIds: ReadonlySet<InstanceId>;
  readonly hoveredInstanceId?: InstanceId;
  readonly selectedBodyIds: ReadonlyMap<InstanceId, ReadonlySet<BodyId>>;
  readonly highlightedBodyIds: ReadonlyMap<InstanceId, ReadonlySet<BodyId>>;
  readonly hoveredBody?: BodyRef;
  readonly bodyOverrides: ReadonlyMap<InstanceId, ReadonlyMap<BodyId, StyleOverride>>;
  readonly hiddenBodyIds: ReadonlyMap<InstanceId, ReadonlySet<BodyId>>;
  readonly selectedElementIds: ReadonlyMap<InstanceId, ReadonlySet<ElementId>>;
  readonly hoveredElement?: ElementRef;
  readonly elementOverrides: ReadonlyMap<InstanceId, ReadonlyMap<ElementId, StyleOverride>>;
  readonly partOverrides: ReadonlyMap<PartId, StyleOverride>;
  readonly instanceOverrides: ReadonlyMap<InstanceId, StyleOverride>;
  readonly selectedNodeIds: ReadonlyMap<InstanceId, ReadonlySet<NodeId>>;
  readonly highlightedNodeIds: ReadonlyMap<InstanceId, ReadonlySet<NodeId>>;
  readonly hoveredNode?: NodeRef;
  readonly selectedFaces: ReadonlyMap<InstanceId, ReadonlyMap<FaceKey, ElementId>>;
  readonly highlightedFaces: ReadonlyMap<InstanceId, ReadonlyMap<FaceKey, ElementId>>;
  readonly hoveredFace?: FaceRef;
  readonly theme: InteractionTheme;
}

const defaultTheme: InteractionTheme = {
  highlighted: { emissive: 0.35 },
  selected: { color: { r: 1, g: 0.75, b: 0.1, a: 1 }, emissive: 0.6 },
  hovered: { emissive: 0.2 },
  hoveredFace: { emissive: 0.3 },
  selectedFace: { color: { r: 0.45, g: 1, b: 0.4, a: 1 }, emissive: 0.5 },
  hoveredNode: { emissive: 0.45 },
  selectedNode: { color: { r: 1, g: 0.42, b: 0.12, a: 1 }, emissive: 0.7 },
};

/** Creates an empty interaction state. */
export function createInteractionState(theme: InteractionTheme = defaultTheme): InteractionState {
  return {
    highlightedPartIds: new Set(),
    highlightedInstanceIds: new Set(),
    selectedPartIds: new Set(),
    selectedInstanceIds: new Set(),
    selectedBodyIds: new Map(),
    highlightedBodyIds: new Map(),
    bodyOverrides: new Map(),
    hiddenBodyIds: new Map(),
    selectedElementIds: new Map(),
    elementOverrides: new Map(),
    partOverrides: new Map(),
    instanceOverrides: new Map(),
    selectedNodeIds: new Map(),
    highlightedNodeIds: new Map(),
    selectedFaces: new Map(),
    highlightedFaces: new Map(),
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
  const selectedElementIds = updateNestedSet(
    state.selectedElementIds,
    ref.instanceId,
    ref.elementId,
    selected,
  );
  if (selectedElementIds === state.selectedElementIds) return state;
  return { ...state, selectedElementIds };
}

/** Sets the currently hovered element, or clears hover with `undefined`. */
export function setHoveredElement(
  state: InteractionState,
  ref: ElementRef | undefined,
): InteractionState {
  if (sameRef(state.hoveredElement, ref, (value) => [value.instanceId, value.elementId])) {
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
  const elementOverrides = updateNestedMap(
    state.elementOverrides,
    ref.instanceId,
    ref.elementId,
    override,
  );
  if (elementOverrides === state.elementOverrides) return state;
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
  return applyStyleLayers(base, overrides);
}

/** Resolves one body occurrence after part and instance styles. */
export function resolveBodyStyle(
  instance: Instance,
  bodyId: BodyId,
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const style = resolveInstanceStyle(instance, base, state);
  return applyStyleLayers(style, [
    state.highlightedBodyIds.get(instance.instanceId)?.has(bodyId) === true
      ? state.theme.highlighted
      : undefined,
    sameRef(state.hoveredBody, { instanceId: instance.instanceId, bodyId }, (value) => [
      value.instanceId,
      value.bodyId,
    ])
      ? state.theme.hovered
      : undefined,
    state.selectedBodyIds.get(instance.instanceId)?.has(bodyId) === true
      ? state.theme.selected
      : undefined,
    state.bodyOverrides.get(instance.instanceId)?.get(bodyId),
  ]);
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
  bodyId?: BodyId,
): ResolvedStyle {
  const style =
    bodyId === undefined
      ? resolveInstanceStyle(instance, base, state)
      : resolveBodyStyle(instance, bodyId, base, state);
  return applyStyleLayers(style, [
    sameRef(state.hoveredElement, { instanceId: instance.instanceId, elementId }, (value) => [
      value.instanceId,
      value.elementId,
    ])
      ? state.theme.hovered
      : undefined,
    state.selectedElementIds.get(instance.instanceId)?.has(elementId) === true
      ? state.theme.selected
      : undefined,
    state.elementOverrides.get(instance.instanceId)?.get(elementId),
  ]);
}

/**
 * Collects every element occurrence that currently carries element-level
 * emphasis (hovered, selected, or explicitly overridden), in deterministic
 * order with no duplicates.
 */
export function emphasizedElementRefs(state: InteractionState): readonly ElementRef[] {
  return collectUniqueRefs(
    state.hoveredElement,
    (ref) => `${ref.instanceId}/${ref.elementId}`,
    (push) => {
      for (const [instanceId, ids] of state.selectedElementIds) {
        for (const elementId of sortedNumbers(ids)) push({ instanceId, elementId });
      }
      for (const [instanceId, overrides] of state.elementOverrides) {
        for (const elementId of sortedNumbers(overrides.keys())) push({ instanceId, elementId });
      }
    },
  );
}

function updatePartSet(
  state: InteractionState,
  key: "highlightedPartIds" | "selectedPartIds",
  value: PartId,
  enabled: boolean,
): InteractionState {
  const next = updateSet(state[key], value, enabled);
  if (next === state[key]) return state;
  return { ...state, [key]: next };
}

function updateInstanceSet(
  state: InteractionState,
  key: "highlightedInstanceIds" | "selectedInstanceIds",
  value: InstanceId,
  enabled: boolean,
): InteractionState {
  const next = updateSet(state[key], value, enabled);
  if (next === state[key]) return state;
  return { ...state, [key]: next };
}

function updatePartOverride(
  state: InteractionState,
  value: PartId,
  override: StyleOverride | undefined,
): InteractionState {
  const next = updateMapValue(state.partOverrides, value, override);
  if (next === state.partOverrides) return state;
  return { ...state, partOverrides: next };
}

function updateInstanceOverride(
  state: InteractionState,
  value: InstanceId,
  override: StyleOverride | undefined,
): InteractionState {
  const next = updateMapValue(state.instanceOverrides, value, override);
  if (next === state.instanceOverrides) return state;
  return { ...state, instanceOverrides: next };
}
