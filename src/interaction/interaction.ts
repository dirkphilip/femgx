import type { ElementId, ElementRef, InstanceId } from "../scene/types";
import type { BodyId, PartId } from "../geometry/part";
import type { InteractionTarget } from "./target-types";
import {
  createInteractionStateValue,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type InteractionStateData,
  type InteractionTheme,
  type PrimitiveStyleOverride,
  type ResolvedStyle,
  type StyleOverride,
  validatePrimitiveStyleOverride,
  validateStyleOverride,
} from "./state";
import {
  applyStyleLayers,
  collectUniqueRefs,
  sortedNumbers,
  updateMapValue,
  updateNestedMap,
  updateNestedSet,
  updateSet,
} from "./mechanics";
import { setInstanceOverrides } from "./instance-overrides";

export { setInstanceOverrides } from "./instance-overrides";

export type {
  Color,
  InteractionState,
  InteractionTheme,
  PrimitiveStyleOverride,
  ResolvedStyle,
  StyleOverride,
} from "./state";

const defaultTheme: InteractionTheme = {
  highlighted: { emissive: 0.35 },
  selected: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 } },
};

/**
 * Creates an empty interaction state.
 * @category Interaction and picking
 */
export function createInteractionState(theme: InteractionTheme = defaultTheme): InteractionState {
  for (const style of Object.values(theme) as readonly PrimitiveStyleOverride[]) {
    validatePrimitiveStyleOverride(style);
  }
  const data: InteractionStateData = {
    highlightedPartIds: new Set(),
    highlightedInstanceIds: new Set(),
    selectedPartIds: new Set(),
    selectedInstanceIds: new Set(),
    selectedBodyIds: new Map(),
    highlightedBodyIds: new Map(),
    bodyOverrides: new Map(),
    hiddenBodyIds: new Map(),
    selectedElementIds: new Map(),
    highlightedElementIds: new Map(),
    hiddenElementIds: new Map(),
    elementOverrides: new Map(),
    partOverrides: new Map(),
    instanceOverrides: new Map(),
    selectedNodeIds: new Map(),
    highlightedNodeIds: new Map(),
    selectedEdges: new Map(),
    highlightedEdges: new Map(),
    selectedFaces: new Map(),
    highlightedFaces: new Map(),
    theme: copyTheme(theme),
  };
  return createInteractionStateValue(data);
}

function copyTheme(theme: InteractionTheme): InteractionTheme {
  return Object.freeze({
    highlighted: copyPrimitiveStyle(theme.highlighted),
    selected: copyPrimitiveStyle(theme.selected),
  });
}

function copyPrimitiveStyle(style: PrimitiveStyleOverride): PrimitiveStyleOverride {
  return Object.freeze({
    ...style,
    ...(style.color === undefined ? {} : { color: Object.freeze({ ...style.color }) }),
  });
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

/** Sets or clears an element selection without mutating the previous state. */
export function setElementSelected(
  state: InteractionState,
  ref: ElementRef,
  selected: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const selectedElementIds = updateNestedSet(
    data.selectedElementIds,
    ref.instanceId,
    ref.elementId,
    selected,
  );
  if (selectedElementIds === data.selectedElementIds) return state;
  return updateInteractionState(state, { selectedElementIds });
}

/** Sets or clears an element highlight without mutating the previous state. */
export function setElementHighlighted(
  state: InteractionState,
  ref: ElementRef,
  highlighted: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const highlightedElementIds = updateNestedSet(
    data.highlightedElementIds,
    ref.instanceId,
    ref.elementId,
    highlighted,
  );
  if (highlightedElementIds === data.highlightedElementIds) return state;
  return updateInteractionState(state, { highlightedElementIds });
}

/**
 * Adds or replaces an explicit element style override.
 * @category Interaction and picking
 */
export function setElementOverride(
  state: InteractionState,
  ref: ElementRef,
  override: PrimitiveStyleOverride | undefined,
): InteractionState {
  validatePrimitiveStyleOverride(override);
  const data = readInteractionState(state);
  const elementOverrides = updateNestedMap(
    data.elementOverrides,
    ref.instanceId,
    ref.elementId,
    override,
  );
  if (elementOverrides === data.elementOverrides) return state;
  return updateInteractionState(state, { elementOverrides });
}

/**
 * Adds or replaces an explicit part style override.
 * @category Interaction and picking
 */
export function setPartOverride(
  state: InteractionState,
  partId: PartId,
  override: StyleOverride | undefined,
): InteractionState {
  validateStyleOverride(override);
  return updatePartOverride(state, partId, override);
}

/**
 * Adds or replaces an explicit instance style override.
 * @category Interaction and picking
 */
export function setInstanceOverride(
  state: InteractionState,
  instanceId: InstanceId,
  override: StyleOverride | undefined,
): InteractionState {
  return setInstanceOverrides(state, [[instanceId, override]]);
}

/**
 * Resolves all active state into one renderer-ready style.
 * @category Interaction and picking
 */
export function resolveInstanceStyle(
  instance: { readonly instanceId: InstanceId; readonly partId: PartId },
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const data = readInteractionState(state);
  const overrides: StyleOverride[] = [];
  if (data.selectedPartIds.has(instance.partId))
    overrides.push(applySelectionStyle(base, data.theme.selected));
  if (data.selectedInstanceIds.has(instance.instanceId))
    overrides.push(applySelectionStyle(base, data.theme.selected));
  if (data.highlightedPartIds.has(instance.partId))
    overrides.push(applySelectionStyle(base, data.theme.highlighted));
  if (data.highlightedInstanceIds.has(instance.instanceId))
    overrides.push(applySelectionStyle(base, data.theme.highlighted));
  if (hoveredInstanceId(data.hoveredTarget, instance) !== undefined)
    overrides.push(applySelectionStyle(base, data.theme.highlighted));
  const partOverride = data.partOverrides.get(instance.partId);
  if (partOverride !== undefined) overrides.push(partOverride);
  const instanceOverride = data.instanceOverrides.get(instance.instanceId);
  if (instanceOverride !== undefined) overrides.push(instanceOverride);
  return applyStyleLayers(base, overrides);
}

function hoveredInstanceId(
  target: InteractionTarget | undefined,
  instance: { readonly instanceId: InstanceId; readonly partId: PartId },
): InstanceId | undefined {
  return target?.kind === "instance" && target.instanceId === instance.instanceId
    ? instance.instanceId
    : undefined;
}

/** Applies a selection tint without turning a translucent base surface opaque. */
export function applySelectionStyle(
  base: ResolvedStyle,
  selection: PrimitiveStyleOverride,
): PrimitiveStyleOverride {
  return {
    ...selection,
    ...(selection.color === undefined
      ? {}
      : { color: { ...selection.color, a: selection.color.a * base.color.a } }),
    ...(selection.opacity === undefined ? {} : { opacity: selection.opacity * base.opacity }),
  };
}

/**
 * Resolves one body occurrence after part and instance styles.
 * @category Interaction and picking
 */
export function resolveBodyStyle(
  instance: { readonly instanceId: InstanceId; readonly partId: PartId },
  bodyId: BodyId,
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const data = readInteractionState(state);
  const style = resolveInstanceStyle(instance, base, state);
  return applyStyleLayers(style, [
    data.selectedBodyIds.get(instance.instanceId)?.has(bodyId) === true
      ? applySelectionStyle(style, data.theme.selected)
      : undefined,
    data.highlightedBodyIds.get(instance.instanceId)?.has(bodyId) === true
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.hoveredTarget?.kind === "body" &&
    data.hoveredTarget.instanceId === instance.instanceId &&
    data.hoveredTarget.bodyId === bodyId
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.bodyOverrides.get(instance.instanceId)?.get(bodyId),
  ]);
}

/**
 * Resolves the style of one element occurrence. Element-level state is more
 * specific than part/instance state, so element highlight, element hover,
 * element selection, and explicit element overrides win over
 * `resolveInstanceStyle` results. Within the element level, hover and highlight
 * remain visible over selection, and explicit overrides win last.
 * @category Interaction and picking
 */
export function resolveElementStyle(
  instance: { readonly instanceId: InstanceId; readonly partId: PartId },
  elementId: ElementId,
  base: ResolvedStyle,
  state: InteractionState,
  bodyId?: BodyId,
): ResolvedStyle {
  const data = readInteractionState(state);
  const style =
    bodyId === undefined
      ? resolveInstanceStyle(instance, base, state)
      : resolveBodyStyle(instance, bodyId, base, state);
  return applyStyleLayers(style, [
    data.selectedElementIds.get(instance.instanceId)?.has(elementId) === true
      ? applySelectionStyle(style, data.theme.selected)
      : undefined,
    data.highlightedElementIds.get(instance.instanceId)?.has(elementId) === true
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.hoveredTarget?.kind === "element" &&
    data.hoveredTarget.instanceId === instance.instanceId &&
    data.hoveredTarget.elementId === elementId
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.elementOverrides.get(instance.instanceId)?.get(elementId),
  ]);
}

/**
 * Collects every element occurrence that currently carries element-level
 * emphasis (highlighted, hovered, selected, or explicitly overridden), in deterministic
 * order with no duplicates.
 * @category Interaction and picking
 */
export function emphasizedElementRefs(state: InteractionState): readonly ElementRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "element"
      ? { instanceId: data.hoveredTarget.instanceId, elementId: data.hoveredTarget.elementId }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.elementId}`,
    (push) => {
      for (const [instanceId, ids] of data.highlightedElementIds) {
        for (const elementId of sortedNumbers(ids)) push({ instanceId, elementId });
      }
      for (const [instanceId, ids] of data.selectedElementIds) {
        for (const elementId of sortedNumbers(ids)) push({ instanceId, elementId });
      }
      for (const [instanceId, overrides] of data.elementOverrides) {
        for (const elementId of sortedNumbers(overrides.keys())) push({ instanceId, elementId });
      }
      for (const [instanceId, ids] of data.hiddenElementIds) {
        for (const elementId of sortedNumbers(ids)) push({ instanceId, elementId });
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
  const data = readInteractionState(state);
  const next = updateSet(data[key], value, enabled);
  if (next === data[key]) return state;
  return updateInteractionState(state, { [key]: next });
}

function updateInstanceSet(
  state: InteractionState,
  key: "highlightedInstanceIds" | "selectedInstanceIds",
  value: InstanceId,
  enabled: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const next = updateSet(data[key], value, enabled);
  if (next === data[key]) return state;
  return updateInteractionState(state, { [key]: next });
}

function updatePartOverride(
  state: InteractionState,
  value: PartId,
  override: StyleOverride | undefined,
): InteractionState {
  const data = readInteractionState(state);
  const next = updateMapValue(data.partOverrides, value, override);
  if (next === data.partOverrides) return state;
  return updateInteractionState(state, { partOverrides: next });
}
