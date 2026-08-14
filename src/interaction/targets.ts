import type { BodyRef } from "./refs";
import { setElementBlockHighlighted, setElementBlockSelected } from "./blocks";
import type { StyleOverride } from "./state";
import { setBodyHighlighted, setBodySelected } from "./bodies";
import { setFaceHighlighted, setFaceSelected } from "./faces";
import { setNodeHighlighted, setNodeSelected } from "./nodes";
import {
  readInteractionState,
  setHoveredTarget,
  updateInteractionState,
  type InteractionState,
} from "./state";
import {
  setElementHighlighted,
  setElementSelected,
  setInstanceHighlighted,
  setInstanceSelected,
  setPartHighlighted,
  setPartSelected,
} from "./interaction";
import { hoveredTarget, isHoveredTarget } from "./state";
export type { InteractionTarget } from "./target-types";
import type { InteractionTarget } from "./target-types";
import type { InteractionGranularity, PickHit } from "../picking/types";
import { faceRefKey } from "./refs";

/** Converts a complete physical hit to a host-owned interaction identity. */
export function interactionTargetFromHit(
  hit: PickHit,
  granularity: InteractionGranularity,
): InteractionTarget | undefined {
  switch (granularity) {
    case "part":
      return { kind: "part", partId: hit.partId };
    case "instance":
      return { kind: "instance", instanceId: hit.instanceId };
    case "body":
      return hit.kind !== "instance" && hit.bodyId !== undefined
        ? { kind: "body", instanceId: hit.instanceId, bodyId: hit.bodyId }
        : undefined;
    case "block":
      return hit.kind !== "instance" && hit.blockId !== undefined
        ? { kind: "block", instanceId: hit.instanceId, blockId: hit.blockId }
        : undefined;
    case "element":
      if (hit.kind === "instance") return undefined;
      if (hit.kind === "node") {
        return hit.elementId === undefined
          ? undefined
          : { kind: "element", instanceId: hit.instanceId, elementId: hit.elementId };
      }
      return { kind: "element", instanceId: hit.instanceId, elementId: hit.elementId };
    case "face":
      return hit.kind === "face"
        ? {
            kind: "face",
            instanceId: hit.instanceId,
            elementId: hit.elementId,
            faceIndex: hit.faceIndex,
          }
        : undefined;
    case "node":
      return hit.kind === "node"
        ? { kind: "node", instanceId: hit.instanceId, nodeId: hit.nodeId }
        : undefined;
  }
}

/** Sets or clears selection for any supported stable interaction target. */
export function setTargetSelected(
  state: InteractionState,
  target: InteractionTarget,
  selected: boolean,
): InteractionState {
  switch (target.kind) {
    case "part":
      return setPartSelected(state, target.partId, selected);
    case "instance":
      return setInstanceSelected(state, target.instanceId, selected);
    case "body":
      return setBodySelected(state, target, selected);
    case "block":
      return setElementBlockSelected(state, target, selected);
    case "element":
      return setElementSelected(state, target, selected);
    case "face":
      return setFaceSelected(state, target, selected);
    case "node":
      return setNodeSelected(state, target, selected);
  }
}

/** Sets or clears highlight for any supported stable interaction target. */
export function setTargetHighlighted(
  state: InteractionState,
  target: InteractionTarget,
  highlighted: boolean,
): InteractionState {
  switch (target.kind) {
    case "part":
      return setPartHighlighted(state, target.partId, highlighted);
    case "instance":
      return setInstanceHighlighted(state, target.instanceId, highlighted);
    case "body":
      return setBodyHighlighted(state, target, highlighted);
    case "block":
      return setElementBlockHighlighted(state, target, highlighted);
    case "element":
      return setElementHighlighted(state, target, highlighted);
    case "face":
      return setFaceHighlighted(state, target, highlighted);
    case "node":
      return setNodeHighlighted(state, target, highlighted);
  }
}

/** Applies one deterministic, duplicate-safe highlight operation to many targets. */
export function setTargetsHighlighted(
  state: InteractionState,
  targets: readonly InteractionTarget[],
  highlighted: boolean,
): InteractionState {
  let next = state;
  for (const target of targets) {
    next = setTargetHighlighted(next, target, highlighted);
  }
  return next;
}

/** Sets the single hovered target, replacing any previous hover. */
export function setTargetHovered(
  state: InteractionState,
  target: InteractionTarget | undefined,
): InteractionState {
  return setHoveredTarget(state, target);
}

/** Returns whether a target is selected. */
export function isTargetSelected(state: InteractionState, target: InteractionTarget): boolean {
  const data = readInteractionState(state);
  switch (target.kind) {
    case "part":
      return data.selectedPartIds.has(target.partId);
    case "instance":
      return data.selectedInstanceIds.has(target.instanceId);
    case "body":
      return data.selectedBodyIds.get(target.instanceId)?.has(target.bodyId) === true;
    case "block":
      return data.selectedBlockIds.get(target.instanceId)?.has(target.blockId) === true;
    case "element":
      return data.selectedElementIds.get(target.instanceId)?.has(target.elementId) === true;
    case "face":
      return data.selectedFaces.get(target.instanceId)?.has(faceRefKey(target)) === true;
    case "node":
      return data.selectedNodeIds.get(target.instanceId)?.has(target.nodeId) === true;
  }
}

/** Returns whether a target is highlighted. */
export function isTargetHighlighted(state: InteractionState, target: InteractionTarget): boolean {
  const data = readInteractionState(state);
  switch (target.kind) {
    case "part":
      return data.highlightedPartIds.has(target.partId);
    case "instance":
      return data.highlightedInstanceIds.has(target.instanceId);
    case "body":
      return data.highlightedBodyIds.get(target.instanceId)?.has(target.bodyId) === true;
    case "block":
      return data.highlightedBlockIds.get(target.instanceId)?.has(target.blockId) === true;
    case "element":
      return data.highlightedElementIds.get(target.instanceId)?.has(target.elementId) === true;
    case "face":
      return data.highlightedFaces.get(target.instanceId)?.has(faceRefKey(target)) === true;
    case "node":
      return data.highlightedNodeIds.get(target.instanceId)?.has(target.nodeId) === true;
  }
}

/** Returns whether a target is the one currently hovered target. */
export { hoveredTarget, isHoveredTarget };

/** Returns selected targets in stable kind and identity order. */
export function selectedTargets(state: InteractionState): InteractionTarget[] {
  const data = readInteractionState(state);
  const targets: InteractionTarget[] = [];
  for (const partId of [...data.selectedPartIds].sort((a, b) => a - b)) {
    targets.push({ kind: "part", partId });
  }
  for (const instanceId of [...data.selectedInstanceIds].sort()) {
    targets.push({ kind: "instance", instanceId });
  }
  for (const [instanceId, ids] of [...data.selectedBodyIds.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const bodyId of [...ids].sort((a, b) => a - b))
      targets.push({ kind: "body", instanceId, bodyId });
  }
  for (const [instanceId, ids] of [...data.selectedBlockIds.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const blockId of [...ids].sort((a, b) => a - b))
      targets.push({ kind: "block", instanceId, blockId });
  }
  for (const [instanceId, ids] of [...data.selectedElementIds.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const elementId of [...ids].sort((a, b) => a - b))
      targets.push({ kind: "element", instanceId, elementId });
  }
  for (const [, faces] of [...data.selectedFaces.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const ref of [...faces.values()].sort(
      (a, b) =>
        a.instanceId.localeCompare(b.instanceId) ||
        a.elementId - b.elementId ||
        a.faceIndex - b.faceIndex,
    )) {
      targets.push({
        kind: "face",
        instanceId: ref.instanceId,
        elementId: ref.elementId,
        faceIndex: ref.faceIndex,
      });
    }
  }
  for (const [instanceId, ids] of [...data.selectedNodeIds.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const nodeId of [...ids].sort((a, b) => a - b))
      targets.push({ kind: "node", instanceId, nodeId });
  }
  return targets;
}

/** Returns an explicit body style override, if one is present. */
export function bodyOverride(state: InteractionState, ref: BodyRef): StyleOverride | undefined {
  return readInteractionState(state).bodyOverrides.get(ref.instanceId)?.get(ref.bodyId);
}

/** Clears all six selection collections while preserving every other state layer. */
export function clearSelection(state: InteractionState): InteractionState {
  const data = readInteractionState(state);
  if (
    data.selectedPartIds.size === 0 &&
    data.selectedInstanceIds.size === 0 &&
    data.selectedBodyIds.size === 0 &&
    data.selectedBlockIds.size === 0 &&
    data.selectedElementIds.size === 0 &&
    data.selectedFaces.size === 0 &&
    data.selectedNodeIds.size === 0
  ) {
    return state;
  }
  return updateInteractionState(state, {
    selectedPartIds: new Set(),
    selectedInstanceIds: new Set(),
    selectedBodyIds: new Map(),
    selectedBlockIds: new Map(),
    selectedElementIds: new Map(),
    selectedFaces: new Map(),
    selectedNodeIds: new Map(),
  });
}
