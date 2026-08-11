import type { Instance } from "../scene/types";
import type { InteractionState } from "./interaction";
import type { BodyId } from "../geometry/part";
import { resolveBodyStyle, resolveInstanceStyle, type ResolvedStyle } from "./interaction";
import type { NodeRef } from "./refs";
import {
  applyStyleLayers,
  collectUniqueRefs,
  sameRef,
  sortedNumbers,
  updateNestedSet,
} from "./mechanics";

function updateNodeSet(
  state: InteractionState,
  key: "selectedNodeIds" | "highlightedNodeIds",
  ref: NodeRef,
  enabled: boolean,
): InteractionState {
  const map = updateNestedSet(state[key], ref.instanceId, ref.nodeId, enabled);
  if (map === state[key]) return state;
  return { ...state, [key]: map };
}

/** Sets or clears a node selection without mutating the previous state. */
export function setNodeSelected(
  state: InteractionState,
  ref: NodeRef,
  selected: boolean,
): InteractionState {
  return updateNodeSet(state, "selectedNodeIds", ref, selected);
}

/** Sets or clears a node highlight without mutating the previous state. */
export function setNodeHighlighted(
  state: InteractionState,
  ref: NodeRef,
  highlighted: boolean,
): InteractionState {
  return updateNodeSet(state, "highlightedNodeIds", ref, highlighted);
}

/** Sets the currently hovered node, or clears hover with `undefined`. */
export function setHoveredNode(
  state: InteractionState,
  ref: NodeRef | undefined,
): InteractionState {
  if (sameRef(state.hoveredNode, ref, (value) => [value.instanceId, value.nodeId])) {
    return state;
  }
  if (ref === undefined) {
    const { hoveredNode: _, ...withoutHover } = state;
    return withoutHover;
  }
  return { ...state, hoveredNode: ref };
}

/** Returns whether a node occurrence carries emphasis (hover, highlight, selection). */
export function isNodeEmphasized(state: InteractionState, ref: NodeRef): boolean {
  return (
    (state.hoveredNode?.instanceId === ref.instanceId && state.hoveredNode.nodeId === ref.nodeId) ||
    state.highlightedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true ||
    state.selectedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true
  );
}

/**
 * Resolves the style of one node occurrence. Node-level state is more specific
 * than part/instance state, so node highlight, hover, and selection win over
 * `resolveInstanceStyle`; selection beats hover, and hover beats highlight.
 */
export function resolveNodeStyle(
  instance: Instance,
  ref: NodeRef,
  base: ResolvedStyle,
  state: InteractionState,
  bodyId?: BodyId,
): ResolvedStyle {
  const style =
    bodyId === undefined
      ? resolveInstanceStyle(instance, base, state)
      : resolveBodyStyle(instance, bodyId, base, state);
  return applyStyleLayers(style, [
    state.highlightedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true
      ? state.theme.highlighted
      : undefined,
    sameRef(state.hoveredNode, ref, (value) => [value.instanceId, value.nodeId])
      ? state.theme.hoveredNode
      : undefined,
    state.selectedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true
      ? state.theme.selectedNode
      : undefined,
  ]);
}

/**
 * Collects every node occurrence that currently carries node-level emphasis
 * (hovered, highlighted, or selected), in deterministic order with no
 * duplicates.
 */
export function emphasizedNodeRefs(state: InteractionState): readonly NodeRef[] {
  return collectUniqueRefs(
    state.hoveredNode,
    (ref) => `${ref.instanceId}/${ref.nodeId}`,
    (push) => {
      for (const [instanceId, ids] of state.highlightedNodeIds) {
        for (const nodeId of sortedNumbers(ids)) push({ instanceId, nodeId });
      }
      for (const [instanceId, ids] of state.selectedNodeIds) {
        for (const nodeId of sortedNumbers(ids)) push({ instanceId, nodeId });
      }
    },
  );
}
