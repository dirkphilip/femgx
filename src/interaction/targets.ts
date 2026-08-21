import { faceIdentity as faceId } from "../geometry/element-face-selection";
import { setBodyHighlighted, setBodySelected } from "./bodies";
import { setFaceHighlighted, setFaceSelected } from "./faces";
import { setNodeHighlighted, setNodeSelected } from "./nodes";
import { setEdgeHighlighted, setEdgeSelected } from "./edges";
import {
  readInteractionState,
  setHoveredTarget,
  updateInteractionState,
  type InteractionState,
  type InteractionStateData,
} from "./state";
import {
  setElementHighlighted,
  setElementSelected,
  setPartOccurrenceHighlighted,
  setPartOccurrenceSelected,
  setPartHighlighted,
  setPartSelected,
} from "./interaction";
import { hoveredTarget, isHoveredTarget } from "./state";
import { updateNestedMaps, updateNestedSets, updateSetValues } from "./mechanics";
import {
  updateSelectedTargetCollections,
  type TargetCollections,
  type TargetGroups,
} from "./selection-transients";
export { selectedElementRegion, setElementRegionSelected } from "./element-region-state";
export type { InteractionTarget, InteractionTargetFor } from "./target-types";
import type { InteractionTarget, InteractionTargetFor } from "./target-types";
import type { InteractionGranularity, PickHit } from "../picking/types";
export { bodyOverride, clearSelection, selectedTargets } from "./selection-queries";
export {
  createElementRegionSelection,
  type ElementRegionSelection,
} from "./element-region-selection";

/**
 * Converts a complete physical hit to a host-owned interaction identity.
 * @category Interaction and picking
 */
export function interactionTargetFromHit<K extends InteractionGranularity>(
  hit: PickHit,
  granularity: K,
): InteractionTargetFor<K> | undefined;
export function interactionTargetFromHit(
  hit: PickHit,
  granularity: InteractionGranularity,
): InteractionTarget | undefined {
  switch (granularity) {
    case "part":
      return { kind: "part", partId: hit.partId };
    case "partOccurrence":
      return { kind: "partOccurrence", partOccurrenceId: hit.partOccurrenceId };
    case "body":
      return hit.kind !== "partOccurrence" && hit.kind !== "edge" && hit.bodyId !== undefined
        ? { kind: "body", partOccurrenceId: hit.partOccurrenceId, bodyId: hit.bodyId }
        : undefined;
    case "element":
      if (hit.kind === "partOccurrence" || hit.kind === "edge") return undefined;
      if (hit.kind === "node") {
        return hit.elementId === undefined
          ? undefined
          : { kind: "element", partOccurrenceId: hit.partOccurrenceId, elementId: hit.elementId };
      }
      return { kind: "element", partOccurrenceId: hit.partOccurrenceId, elementId: hit.elementId };
    case "face":
      return hit.kind === "face"
        ? {
            kind: "face",
            partOccurrenceId: hit.partOccurrenceId,
            elementId: hit.elementId,
            faceIndex: hit.faceIndex,
          }
        : undefined;
    case "node":
      return hit.kind === "node"
        ? { kind: "node", partOccurrenceId: hit.partOccurrenceId, nodeId: hit.nodeId }
        : undefined;
    case "edge":
      return hit.kind === "edge"
        ? { kind: "edge", partOccurrenceId: hit.partOccurrenceId, key: hit.key }
        : undefined;
  }
}

/**
 * Sets or clears selection for any supported stable interaction target.
 * @category Interaction and picking
 */
export function setTargetSelected(
  state: InteractionState,
  target: InteractionTarget,
  selected: boolean,
): InteractionState {
  switch (target.kind) {
    case "part":
      return setPartSelected(state, target.partId, selected);
    case "partOccurrence":
      return setPartOccurrenceSelected(state, target.partOccurrenceId, selected);
    case "body":
      return setBodySelected(state, target, selected);
    case "element":
      return setElementSelected(state, target, selected);
    case "face":
      return setFaceSelected(state, target, selected);
    case "node":
      return setNodeSelected(state, target, selected);
    case "edge":
      return setEdgeSelected(state, target, selected);
  }
}

/**
 * Sets or clears selection for many targets in one immutable state transition.
 * Duplicate identities are applied once, and each touched collection is cloned
 * at most once.
 * @category Interaction and picking
 */
export function setTargetsSelected(
  state: InteractionState,
  targets: readonly InteractionTarget[],
  selected: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const current = selectedCollections(data);
  const next = updateSelectedTargetCollections(current, collectTargetGroups(targets), selected);
  if (targetCollectionsEqual(current, next)) return state;
  return updateInteractionState(state, {
    selectedPartIds: next.partIds,
    selectedPartOccurrenceIds: next.partOccurrenceIds,
    selectedBodyIds: next.bodyIds,
    selectedElementIds: next.elementIds,
    selectedFaces: next.faceRefs,
    selectedNodeIds: next.nodeIds,
    selectedEdges: next.edgeRefs,
  });
}

function collectTargetGroups(targets: readonly InteractionTarget[]): TargetGroups {
  const groups: TargetGroups = {
    partIds: new Set(),
    partOccurrenceIds: new Set(),
    bodyIds: new Map(),
    elementIds: new Map(),
    faceRefs: new Map(),
    nodeIds: new Map(),
    edgeRefs: new Map(),
  };
  // Each target-kind collection is keyed by its complete identity and deduplicates itself.
  for (const target of targets) {
    switch (target.kind) {
      case "part":
        groups.partIds.add(target.partId);
        break;
      case "partOccurrence":
        groups.partOccurrenceIds.add(target.partOccurrenceId);
        break;
      case "body":
        addNestedValue(groups.bodyIds, target.partOccurrenceId, target.bodyId);
        break;
      case "element":
        addNestedValue(groups.elementIds, target.partOccurrenceId, target.elementId);
        break;
      case "face": {
        const key = faceId(target.elementId, target.faceIndex);
        addNestedValue(groups.faceRefs, target.partOccurrenceId, key, target);
        break;
      }
      case "node":
        addNestedValue(groups.nodeIds, target.partOccurrenceId, target.nodeId);
        break;
      case "edge":
        addNestedValue(groups.edgeRefs, target.partOccurrenceId, target.key, target);
        break;
    }
  }
  return groups;
}

function selectedCollections(data: InteractionStateData): TargetCollections {
  return {
    partIds: data.selectedPartIds,
    partOccurrenceIds: data.selectedPartOccurrenceIds,
    bodyIds: data.selectedBodyIds,
    elementIds: data.selectedElementIds,
    faceRefs: data.selectedFaces,
    nodeIds: data.selectedNodeIds,
    edgeRefs: data.selectedEdges,
  };
}

function highlightedCollections(data: InteractionStateData): TargetCollections {
  return {
    partIds: data.highlightedPartIds,
    partOccurrenceIds: data.highlightedPartOccurrenceIds,
    bodyIds: data.highlightedBodyIds,
    elementIds: data.highlightedElementIds,
    faceRefs: data.highlightedFaces,
    nodeIds: data.highlightedNodeIds,
    edgeRefs: data.highlightedEdges,
  };
}

function updateTargetCollections(
  current: TargetCollections,
  groups: TargetGroups,
  enabled: boolean,
): TargetCollections {
  return {
    partIds: updateSetValues(current.partIds, groups.partIds, enabled),
    partOccurrenceIds: updateSetValues(
      current.partOccurrenceIds,
      groups.partOccurrenceIds,
      enabled,
    ),
    bodyIds: updateNestedSets(current.bodyIds, groups.bodyIds, enabled),
    elementIds: updateNestedSets(current.elementIds, groups.elementIds, enabled),
    faceRefs: updateNestedMaps(current.faceRefs, groups.faceRefs, enabled),
    nodeIds: updateNestedSets(current.nodeIds, groups.nodeIds, enabled),
    edgeRefs: updateNestedMaps(current.edgeRefs, groups.edgeRefs, enabled),
  };
}

function targetCollectionsEqual(left: TargetCollections, right: TargetCollections): boolean {
  return (
    left.partIds === right.partIds &&
    left.partOccurrenceIds === right.partOccurrenceIds &&
    left.bodyIds === right.bodyIds &&
    left.elementIds === right.elementIds &&
    left.faceRefs === right.faceRefs &&
    left.nodeIds === right.nodeIds &&
    left.edgeRefs === right.edgeRefs
  );
}

function addNestedValue<OuterKey, InnerKey>(
  groups: Map<OuterKey, Set<InnerKey>>,
  outerKey: OuterKey,
  innerKey: InnerKey,
): void;
function addNestedValue<OuterKey, InnerKey, Value>(
  groups: Map<OuterKey, Map<InnerKey, Value>>,
  outerKey: OuterKey,
  innerKey: InnerKey,
  value: Value,
): void;
function addNestedValue<OuterKey, InnerKey, Value>(
  groups: Map<OuterKey, Set<InnerKey> | Map<InnerKey, Value>>,
  outerKey: OuterKey,
  innerKey: InnerKey,
  value?: Value,
): void {
  const existing = groups.get(outerKey);
  if (existing === undefined) {
    groups.set(outerKey, value === undefined ? new Set([innerKey]) : new Map([[innerKey, value]]));
  } else if (existing instanceof Set) {
    existing.add(innerKey);
  } else if (value !== undefined) {
    existing.set(innerKey, value);
  }
}

/**
 * Sets or clears highlight for any supported stable interaction target.
 * @category Interaction and picking
 */
export function setTargetHighlighted(
  state: InteractionState,
  target: InteractionTarget,
  highlighted: boolean,
): InteractionState {
  switch (target.kind) {
    case "part":
      return setPartHighlighted(state, target.partId, highlighted);
    case "partOccurrence":
      return setPartOccurrenceHighlighted(state, target.partOccurrenceId, highlighted);
    case "body":
      return setBodyHighlighted(state, target, highlighted);
    case "element":
      return setElementHighlighted(state, target, highlighted);
    case "face":
      return setFaceHighlighted(state, target, highlighted);
    case "node":
      return setNodeHighlighted(state, target, highlighted);
    case "edge":
      return setEdgeHighlighted(state, target, highlighted);
  }
}

/**
 * Applies one deterministic, duplicate-safe highlight operation to many targets.
 * @category Interaction and picking
 */
export function setTargetsHighlighted(
  state: InteractionState,
  targets: readonly InteractionTarget[],
  highlighted: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const current = highlightedCollections(data);
  const next = updateTargetCollections(current, collectTargetGroups(targets), highlighted);
  if (targetCollectionsEqual(current, next)) return state;
  return updateInteractionState(state, {
    highlightedPartIds: next.partIds,
    highlightedPartOccurrenceIds: next.partOccurrenceIds,
    highlightedBodyIds: next.bodyIds,
    highlightedElementIds: next.elementIds,
    highlightedFaces: next.faceRefs,
    highlightedNodeIds: next.nodeIds,
    highlightedEdges: next.edgeRefs,
  });
}

/**
 * Sets the single hovered target, replacing any previous hover.
 * @category Interaction and picking
 */
export function setTargetHovered(
  state: InteractionState,
  target: InteractionTarget | undefined,
): InteractionState {
  return setHoveredTarget(state, target);
}

/**
 * Returns whether a target is selected.
 * @category Interaction and picking
 */
export function isTargetSelected(state: InteractionState, target: InteractionTarget): boolean {
  const data = readInteractionState(state);
  switch (target.kind) {
    case "part":
      return data.selectedPartIds.has(target.partId);
    case "partOccurrence":
      return data.selectedPartOccurrenceIds.has(target.partOccurrenceId);
    case "body":
      return data.selectedBodyIds.get(target.partOccurrenceId)?.has(target.bodyId) === true;
    case "element":
      return data.selectedElementIds.get(target.partOccurrenceId)?.has(target.elementId) === true;
    case "face": {
      const key = faceId(target.elementId, target.faceIndex);
      return data.selectedFaces.get(target.partOccurrenceId)?.has(key) === true;
    }
    case "node":
      return data.selectedNodeIds.get(target.partOccurrenceId)?.has(target.nodeId) === true;
    case "edge":
      return data.selectedEdges.get(target.partOccurrenceId)?.has(target.key) === true;
  }
}

/**
 * Returns whether a target is highlighted.
 * @category Interaction and picking
 */
export function isTargetHighlighted(state: InteractionState, target: InteractionTarget): boolean {
  const data = readInteractionState(state);
  switch (target.kind) {
    case "part":
      return data.highlightedPartIds.has(target.partId);
    case "partOccurrence":
      return data.highlightedPartOccurrenceIds.has(target.partOccurrenceId);
    case "body":
      return data.highlightedBodyIds.get(target.partOccurrenceId)?.has(target.bodyId) === true;
    case "element":
      return (
        data.highlightedElementIds.get(target.partOccurrenceId)?.has(target.elementId) === true
      );
    case "face": {
      const key = faceId(target.elementId, target.faceIndex);
      return data.highlightedFaces.get(target.partOccurrenceId)?.has(key) === true;
    }
    case "node":
      return data.highlightedNodeIds.get(target.partOccurrenceId)?.has(target.nodeId) === true;
    case "edge":
      return data.highlightedEdges.get(target.partOccurrenceId)?.has(target.key) === true;
  }
}

/** Returns whether a target is the one currently hovered target. */
export { hoveredTarget, isHoveredTarget };
