import {
  isHoveredTarget,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type ResolvedStyle,
} from "./state";
import type { PartOccurrenceId } from "../scene/types";
import type { PartId } from "../geometry/part";
import { applySelectionPrecedence, applySelectionStyle, resolveInstanceStyle } from "./interaction";
import type { EdgeRef } from "./refs";
import { applyStyleLayers, collectUniqueRefs, sortedStrings, updateNestedMap } from "./mechanics";

function updateEdgeSet(
  state: InteractionState,
  key: "selectedEdges" | "highlightedEdges",
  ref: EdgeRef,
  enabled: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const map = updateNestedMap(data[key], ref.partOccurrenceId, ref.key, enabled ? ref : undefined);
  if (map === data[key]) return state;
  return updateInteractionState(state, { [key]: map });
}

/** Sets or clears one authored-edge selection. */
export function setEdgeSelected(
  state: InteractionState,
  ref: EdgeRef,
  selected: boolean,
): InteractionState {
  return updateEdgeSet(state, "selectedEdges", ref, selected);
}

/** Sets or clears one authored-edge highlight. */
export function setEdgeHighlighted(
  state: InteractionState,
  ref: EdgeRef,
  highlighted: boolean,
): InteractionState {
  return updateEdgeSet(state, "highlightedEdges", ref, highlighted);
}

/** Resolves the renderer style of one authored edge occurrence. */
export function resolveEdgeStyle(
  instance: { readonly partOccurrenceId: PartOccurrenceId; readonly partId: PartId },
  ref: EdgeRef,
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const data = readInteractionState(state);
  const style = resolveInstanceStyle(instance, base, state);
  const emphasized = applyStyleLayers(style, [
    data.highlightedEdges.get(ref.partOccurrenceId)?.has(ref.key) === true
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    isHoveredTarget(state, { kind: "edge", ...ref })
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    data.selectedEdges.get(ref.partOccurrenceId)?.has(ref.key) === true
      ? applySelectionStyle(style, data.theme.selected)
      : undefined,
  ]);
  return applySelectionPrecedence(style, emphasized, instance, state, {
    selected: data.selectedEdges.get(ref.partOccurrenceId)?.has(ref.key) === true,
  });
}

/** Collects emphasized authored edges in deterministic occurrence/key order. */
export function emphasizedEdgeRefs(state: InteractionState): readonly EdgeRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "edge"
      ? { partOccurrenceId: data.hoveredTarget.partOccurrenceId, key: data.hoveredTarget.key }
      : undefined,
    (ref) => `${ref.partOccurrenceId}/${ref.key}`,
    (push) => {
      for (const [, edges] of data.highlightedEdges) {
        for (const key of sortedStrings(edges.keys())) {
          const ref = edges.get(key);
          if (ref !== undefined) push(ref);
        }
      }
      for (const [, edges] of data.selectedEdges) {
        for (const key of sortedStrings(edges.keys())) {
          const ref = edges.get(key);
          if (ref !== undefined) push(ref);
        }
      }
    },
  );
}
