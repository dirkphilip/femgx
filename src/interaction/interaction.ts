import type { ElementId, ElementRef, PartOccurrenceId } from "../scene/types";
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
import { setPartOccurrenceOverrides } from "./style-overrides";

export { setPartOccurrenceOverrides, setPartOverrides } from "./style-overrides";

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
    highlightedPartOccurrenceIds: new Set(),
    selectedPartIds: new Set(),
    selectedPartOccurrenceIds: new Set(),
    selectedBodyIds: new Map(),
    highlightedBodyIds: new Map(),
    bodyOverrides: new Map(),
    hiddenBodyIds: new Map(),
    selectedElementIds: new Map(),
    highlightedElementIds: new Map(),
    hiddenElementIds: new Map(),
    elementOverrides: new Map(),
    partOverrides: new Map(),
    partOccurrenceOverrides: new Map(),
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
export function setPartOccurrenceHighlighted(
  state: InteractionState,
  partOccurrenceId: PartOccurrenceId,
  highlighted: boolean,
): InteractionState {
  return updateInstanceSet(state, "highlightedPartOccurrenceIds", partOccurrenceId, highlighted);
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
export function setPartOccurrenceSelected(
  state: InteractionState,
  partOccurrenceId: PartOccurrenceId,
  selected: boolean,
): InteractionState {
  return updateInstanceSet(state, "selectedPartOccurrenceIds", partOccurrenceId, selected);
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
    ref.partOccurrenceId,
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
    ref.partOccurrenceId,
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
    ref.partOccurrenceId,
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
 * Adds or replaces an explicit part-occurrence style override.
 * @category Interaction and picking
 */
export function setPartOccurrenceOverride(
  state: InteractionState,
  partOccurrenceId: PartOccurrenceId,
  override: StyleOverride | undefined,
): InteractionState {
  return setPartOccurrenceOverrides(state, [[partOccurrenceId, override]]);
}

/**
 * Resolves all active state into one renderer-ready style.
 * @category Interaction and picking
 */
export function resolveInstanceStyle(
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const data = readInteractionState(state);
  const overrides: StyleOverride[] = [];
  if (data.selectedPartIds.has(instance.partId))
    overrides.push(applySelectionStyle(base, data.theme.selected));
  if (data.selectedPartOccurrenceIds.has(instance.partOccurrenceId))
    overrides.push(applySelectionStyle(base, data.theme.selected));
  if (data.highlightedPartIds.has(instance.partId))
    overrides.push(applySelectionStyle(base, data.theme.highlighted));
  if (data.highlightedPartOccurrenceIds.has(instance.partOccurrenceId))
    overrides.push(applySelectionStyle(base, data.theme.highlighted));
  if (hoveredInstanceId(data.hoveredTarget, instance) !== undefined)
    overrides.push(applySelectionStyle(base, data.theme.highlighted));
  const partOverride = data.partOverrides.get(instance.partId);
  if (partOverride !== undefined) overrides.push(partOverride);
  const instanceOverride = data.partOccurrenceOverrides.get(instance.partOccurrenceId);
  if (instanceOverride !== undefined) overrides.push(instanceOverride);
  return applyStyleLayers(base, overrides);
}

function hoveredInstanceId(
  target: InteractionTarget | undefined,
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
): PartOccurrenceId | undefined {
  return target?.kind === "partOccurrence" && target.partOccurrenceId === instance.partOccurrenceId
    ? instance.partOccurrenceId
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
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
  bodyId: BodyId,
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const data = readInteractionState(state);
  const style = resolveInstanceStyle(instance, base, state);
  return applyStyleLayers(style, [
    data.selectedBodyIds.get(instance.partOccurrenceId)?.has(bodyId) === true
      ? applySelectionStyle(style, data.theme.selected)
      : undefined,
    data.highlightedBodyIds.get(instance.partOccurrenceId)?.has(bodyId) === true
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.hoveredTarget?.kind === "body" &&
    data.hoveredTarget.partOccurrenceId === instance.partOccurrenceId &&
    data.hoveredTarget.bodyId === bodyId
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.bodyOverrides.get(instance.partOccurrenceId)?.get(bodyId),
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
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
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
    data.selectedElementIds.get(instance.partOccurrenceId)?.has(elementId) === true
      ? applySelectionStyle(style, data.theme.selected)
      : undefined,
    data.highlightedElementIds.get(instance.partOccurrenceId)?.has(elementId) === true
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.hoveredTarget?.kind === "element" &&
    data.hoveredTarget.partOccurrenceId === instance.partOccurrenceId &&
    data.hoveredTarget.elementId === elementId
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.elementOverrides.get(instance.partOccurrenceId)?.get(elementId),
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
      ? {
          partOccurrenceId: data.hoveredTarget.partOccurrenceId,
          elementId: data.hoveredTarget.elementId,
        }
      : undefined,
    (ref) => `${ref.partOccurrenceId}/${ref.elementId}`,
    (push) => {
      for (const [partOccurrenceId, ids] of data.highlightedElementIds) {
        for (const elementId of sortedNumbers(ids)) push({ partOccurrenceId, elementId });
      }
      for (const [partOccurrenceId, ids] of data.selectedElementIds) {
        for (const elementId of sortedNumbers(ids)) push({ partOccurrenceId, elementId });
      }
      for (const [partOccurrenceId, overrides] of data.elementOverrides) {
        for (const elementId of sortedNumbers(overrides.keys()))
          push({ partOccurrenceId, elementId });
      }
      for (const [partOccurrenceId, ids] of data.hiddenElementIds) {
        for (const elementId of sortedNumbers(ids)) push({ partOccurrenceId, elementId });
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
  key: "highlightedPartOccurrenceIds" | "selectedPartOccurrenceIds",
  value: PartOccurrenceId,
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
