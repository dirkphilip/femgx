import type { PartId } from "../geometry/part";
import type { PartOccurrenceId } from "../scene/types";
import type { InteractionTarget } from "./target-types";
import { applyStyleLayers } from "./mechanics";
import { applySelectionStyle } from "./style-composition";
import { readInteractionState, type InteractionState, type ResolvedStyle } from "./state";

/** Resolves instance emphasis, selection, and explicit instance overrides. */
export function resolveInstanceStyleLayers(
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
  base: ResolvedStyle,
  state: InteractionState,
  includeSelection: boolean,
  hierarchy: { readonly highlighted?: boolean; readonly selected?: boolean } = {},
): ResolvedStyle {
  const data = readInteractionState(state);
  const emphasized = applyStyleLayers(base, [
    data.highlightedPartIds.has(instance.partId)
      ? applySelectionStyle(base, data.theme.highlighted)
      : undefined,
    data.highlightedPartOccurrenceIds.has(instance.partOccurrenceId)
      ? applySelectionStyle(base, data.theme.highlighted)
      : undefined,
    hoveredInstanceId(data.hoveredTarget, instance) !== undefined
      ? applySelectionStyle(base, data.theme.highlighted)
      : undefined,
    hierarchy.highlighted === true ? applySelectionStyle(base, data.theme.highlighted) : undefined,
  ]);
  const selected = includeSelection
    ? applyStyleLayers(emphasized, [
        data.selectedPartIds.has(instance.partId)
          ? applySelectionStyle(base, data.theme.selected)
          : undefined,
        data.selectedPartOccurrenceIds.has(instance.partOccurrenceId)
          ? applySelectionStyle(base, data.theme.selected)
          : undefined,
        hierarchy.selected === true ? applySelectionStyle(base, data.theme.selected) : undefined,
      ])
    : emphasized;
  return applyStyleLayers(selected, [
    data.partOverrides.get(instance.partId),
    data.partOccurrenceOverrides.get(instance.partOccurrenceId),
  ]);
}

function hoveredInstanceId(
  target: InteractionTarget | undefined,
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
): PartOccurrenceId | undefined {
  return target?.kind === "partOccurrence" && target.partOccurrenceId === instance.partOccurrenceId
    ? instance.partOccurrenceId
    : undefined;
}
