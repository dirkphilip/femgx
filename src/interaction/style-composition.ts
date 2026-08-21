import type { BodyId, PartId } from "../geometry/part";
import type { ElementId, PartOccurrenceId } from "../scene/types";
import { applyStyleLayers } from "./mechanics";
import {
  readInteractionState,
  type InteractionState,
  type PrimitiveStyleOverride,
  type ResolvedStyle,
} from "./state";

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

/** Reapplies selection properties after transient emphasis, then restores overrides. */
export function applySelectionPrecedence(
  selectionBase: ResolvedStyle,
  style: ResolvedStyle,
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
  state: InteractionState,
  options: {
    readonly bodyId?: BodyId | undefined;
    readonly elementId?: ElementId;
    readonly selected?: boolean;
  } = {},
): ResolvedStyle {
  const data = readInteractionState(state);
  const selectedBody =
    options.bodyId !== undefined &&
    data.selectedBodyIds.get(instance.partOccurrenceId)?.has(options.bodyId) === true;
  const selectedElement =
    options.elementId !== undefined &&
    data.selectedElementIds.get(instance.partOccurrenceId)?.has(options.elementId) === true;
  const selected = applyStyleLayers(style, [
    data.selectedPartIds.has(instance.partId)
      ? selectionProperties(selectionBase, data.theme.selected)
      : undefined,
    data.selectedPartOccurrenceIds.has(instance.partOccurrenceId)
      ? selectionProperties(selectionBase, data.theme.selected)
      : undefined,
    selectedBody || selectedElement || options.selected === true
      ? applySelectionStyle(selectionBase, data.theme.selected)
      : undefined,
  ]);
  return applyStyleLayers(selected, [
    options.bodyId === undefined
      ? undefined
      : data.bodyOverrides.get(instance.partOccurrenceId)?.get(options.bodyId),
    options.elementId === undefined
      ? undefined
      : data.elementOverrides.get(instance.partOccurrenceId)?.get(options.elementId),
  ]);
}

function selectionProperties(
  style: ResolvedStyle,
  selection: PrimitiveStyleOverride,
): PrimitiveStyleOverride {
  return {
    ...(selection.color === undefined ? {} : { color: style.color }),
    ...(selection.emissive === undefined ? {} : { emissive: style.emissive }),
    ...(selection.opacity === undefined ? {} : { opacity: style.opacity }),
  };
}
