import type { PartId } from "../geometry/part";
import type { PartOccurrenceId } from "../scene/types";
import { resolveInstanceStyle } from "./interaction";
import { resolveInstanceStyleLayers } from "./instance-style";
import { readInteractionState, type InteractionState, type ResolvedStyle } from "./state";

/** Reports whether a primitive style leaves instance color and opacity intact. */
export function keepsResultColor(
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
  base: ResolvedStyle,
  style: ResolvedStyle,
  state: InteractionState,
): boolean {
  const resolvedInstance = resolveInstanceStyle(instance, base, state);
  return style.color === resolvedInstance.color && style.opacity === resolvedInstance.opacity;
}

/** Reports whether selected instance styling leaves authored result colors usable. */
export function keepsInstanceResultColor(
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
  base: ResolvedStyle,
  state: InteractionState,
  hierarchy: { readonly selected?: boolean; readonly highlighted?: boolean } = {},
): boolean {
  const data = readInteractionState(state);
  if (
    data.partOverrides.get(instance.partId)?.color !== undefined ||
    data.partOverrides.get(instance.partId)?.opacity !== undefined ||
    data.partOccurrenceOverrides.get(instance.partOccurrenceId)?.color !== undefined ||
    data.partOccurrenceOverrides.get(instance.partOccurrenceId)?.opacity !== undefined
  ) {
    return false;
  }
  const selected = resolveInstanceStyleLayers(instance, base, state, true, hierarchy);
  const withoutSelection = resolveInstanceStyleLayers(instance, base, state, false, hierarchy);
  return selected.color === withoutSelection.color && selected.opacity === withoutSelection.opacity;
}
