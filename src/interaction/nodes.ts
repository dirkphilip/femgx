import type { Instance } from "../scene/types";
import type { BodyId } from "../geometry/part";
import {
  isHoveredTarget,
  readInteractionState,
  setHoveredTarget,
  updateInteractionState,
  type InteractionState,
  type ResolvedStyle,
} from "./state";
import { resolveBodyStyle, resolveInstanceStyle } from "./interaction";
import type { NodeRef } from "./refs";
import { applyStyleLayers, collectUniqueRefs, sortedNumbers, updateNestedSet } from "./mechanics";

function updateNodeSet(
  state: InteractionState,
  key: "selectedNodeIds" | "highlightedNodeIds",
  ref: NodeRef,
  enabled: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const map = updateNestedSet(data[key], ref.instanceId, ref.nodeId, enabled);
  if (map === data[key]) return state;
  return updateInteractionState(state, { [key]: map });
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
  return setHoveredTarget(state, ref === undefined ? undefined : { kind: "node", ...ref });
}

/** Returns whether a node occurrence carries emphasis (hover, highlight, selection). */
export function isNodeEmphasized(state: InteractionState, ref: NodeRef): boolean {
  const data = readInteractionState(state);
  return (
    isHoveredTarget(state, { kind: "node", ...ref }) ||
    data.highlightedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true ||
    data.selectedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true
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
  const data = readInteractionState(state);
  const style =
    bodyId === undefined
      ? resolveInstanceStyle(instance, base, state)
      : resolveBodyStyle(instance, bodyId, base, state);
  return applyStyleLayers(style, [
    data.highlightedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true
      ? data.theme.highlighted
      : undefined,
    isHoveredTarget(state, { kind: "node", ...ref }) ? data.theme.hoveredNode : undefined,
    data.selectedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true
      ? data.theme.selectedNode
      : undefined,
  ]);
}

/**
 * Collects every node occurrence that currently carries node-level emphasis
 * (hovered, highlighted, or selected), in deterministic order with no
 * duplicates.
 */
export function emphasizedNodeRefs(state: InteractionState): readonly NodeRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "node"
      ? { instanceId: data.hoveredTarget.instanceId, nodeId: data.hoveredTarget.nodeId }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.nodeId}`,
    (push) => {
      for (const [instanceId, ids] of data.highlightedNodeIds) {
        for (const nodeId of sortedNumbers(ids)) push({ instanceId, nodeId });
      }
      for (const [instanceId, ids] of data.selectedNodeIds) {
        for (const nodeId of sortedNumbers(ids)) push({ instanceId, nodeId });
      }
    },
  );
}
