import type { Instance } from "../scene/types";
import {
  isHoveredTarget,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type ResolvedStyle,
} from "./state";
import { applySelectionStyle, resolveInstanceStyle } from "./interaction";
import type { EdgeRef } from "./refs";
import { applyStyleLayers, collectUniqueRefs, sortedStrings, updateNestedMap } from "./mechanics";

function updateEdgeSet(
  state: InteractionState,
  key: "selectedEdges" | "highlightedEdges",
  ref: EdgeRef,
  enabled: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const map = updateNestedMap(data[key], ref.instanceId, ref.key, enabled ? ref : undefined);
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

/** Returns whether an authored edge carries hover, highlight, or selection. */
export function isEdgeEmphasized(state: InteractionState, ref: EdgeRef): boolean {
  const data = readInteractionState(state);
  return (
    isHoveredTarget(state, { kind: "edge", ...ref }) ||
    data.highlightedEdges.get(ref.instanceId)?.has(ref.key) === true ||
    data.selectedEdges.get(ref.instanceId)?.has(ref.key) === true
  );
}

/** Resolves the renderer style of one authored edge occurrence. */
export function resolveEdgeStyle(
  instance: Instance,
  ref: EdgeRef,
  base: ResolvedStyle,
  state: InteractionState,
): ResolvedStyle {
  const data = readInteractionState(state);
  const style = resolveInstanceStyle(instance, base, state);
  return applyStyleLayers(style, [
    data.selectedEdges.get(ref.instanceId)?.has(ref.key) === true
      ? applySelectionStyle(style, data.theme.selected)
      : undefined,
    data.highlightedEdges.get(ref.instanceId)?.has(ref.key) === true
      ? applySelectionStyle(style, data.theme.highlighted)
      : undefined,
    isHoveredTarget(state, { kind: "edge", ...ref })
      ? applySelectionStyle(style, data.theme.hovered)
      : undefined,
  ]);
}

/** Collects emphasized authored edges in deterministic occurrence/key order. */
export function emphasizedEdgeRefs(state: InteractionState): readonly EdgeRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "edge"
      ? { instanceId: data.hoveredTarget.instanceId, key: data.hoveredTarget.key }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.key}`,
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
