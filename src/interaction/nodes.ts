import type { NodeId } from "../elements/element";
import type { Instance, InstanceId } from "../scene/types";
import type { InteractionState } from "./interaction";
import type { BodyId } from "../geometry/part";
import { resolveBodyStyle, resolveInstanceStyle, type ResolvedStyle } from "./interaction";
import type { NodeRef } from "./refs";

function updateNodeSet(
  state: InteractionState,
  key: "selectedNodeIds" | "highlightedNodeIds",
  ref: NodeRef,
  enabled: boolean,
): InteractionState {
  const current = state[key].get(ref.instanceId);
  const has = current?.has(ref.nodeId) ?? false;
  if (has === enabled) return state;
  const ids = new Set(current ?? []);
  if (enabled) ids.add(ref.nodeId);
  else ids.delete(ref.nodeId);
  const map = new Map(state[key]);
  if (ids.size === 0) map.delete(ref.instanceId);
  else map.set(ref.instanceId, ids);
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
  const current = state.hoveredNode;
  if (current === ref) return state;
  if (
    current !== undefined &&
    ref !== undefined &&
    current.instanceId === ref.instanceId &&
    current.nodeId === ref.nodeId
  ) {
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
  let style =
    bodyId === undefined
      ? resolveInstanceStyle(instance, base, state)
      : resolveBodyStyle(instance, bodyId, base, state);
  if (state.highlightedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true) {
    style = { ...style, ...state.theme.highlighted };
  }
  if (state.hoveredNode?.instanceId === ref.instanceId && state.hoveredNode.nodeId === ref.nodeId) {
    style = { ...style, ...state.theme.hoveredNode };
  }
  if (state.selectedNodeIds.get(ref.instanceId)?.has(ref.nodeId) === true) {
    style = { ...style, ...state.theme.selectedNode };
  }
  return style;
}

/**
 * Collects every node occurrence that currently carries node-level emphasis
 * (hovered, highlighted, or selected), in deterministic order with no
 * duplicates.
 */
export function emphasizedNodeRefs(state: InteractionState): readonly NodeRef[] {
  const refs: NodeRef[] = [];
  const seen = new Set<string>();
  const push = (instanceId: InstanceId, nodeId: NodeId): void => {
    const key = `${instanceId}/${nodeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ instanceId, nodeId });
  };
  const hovered = state.hoveredNode;
  if (hovered !== undefined) push(hovered.instanceId, hovered.nodeId);
  for (const [instanceId, ids] of state.highlightedNodeIds) {
    for (const nodeId of sortedNumbers(ids)) push(instanceId, nodeId);
  }
  for (const [instanceId, ids] of state.selectedNodeIds) {
    for (const nodeId of sortedNumbers(ids)) push(instanceId, nodeId);
  }
  return refs;
}

function sortedNumbers(values: Iterable<NodeId>): number[] {
  return Array.from(values).sort((a, b) => a - b);
}
