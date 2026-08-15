import type { EdgeRef, FaceRef } from "./refs";
import { faceIdentity as faceId } from "../geometry/element-face-selection";
import { setElementBlockHighlighted, setElementBlockSelected } from "./blocks";
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
  setInstanceHighlighted,
  setInstanceSelected,
  setPartHighlighted,
  setPartSelected,
} from "./interaction";
import { hoveredTarget, isHoveredTarget } from "./state";
import { updateNestedMaps, updateNestedSets, updateSetValues } from "./mechanics";
export type { InteractionTarget } from "./target-types";
import type { InteractionTarget } from "./target-types";
import type { InteractionGranularity, PickHit } from "../picking/types";
export { bodyOverride, clearSelection, selectedTargets } from "./selection-queries";

/**
 * Converts a complete physical hit to a host-owned interaction identity.
 * @category Interaction and picking
 */
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
      return hit.kind !== "instance" && hit.kind !== "edge" && hit.bodyId !== undefined
        ? { kind: "body", instanceId: hit.instanceId, bodyId: hit.bodyId }
        : undefined;
    case "block":
      return hit.kind !== "instance" && hit.kind !== "edge" && hit.blockId !== undefined
        ? { kind: "block", instanceId: hit.instanceId, blockId: hit.blockId }
        : undefined;
    case "element":
      if (hit.kind === "instance" || hit.kind === "edge") return undefined;
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
    case "edge":
      return hit.kind === "edge"
        ? { kind: "edge", instanceId: hit.instanceId, key: hit.key }
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
  const next = updateTargetCollections(current, collectTargetGroups(targets), selected);
  if (targetCollectionsEqual(current, next)) return state;
  return updateInteractionState(state, {
    selectedPartIds: next.partIds,
    selectedInstanceIds: next.instanceIds,
    selectedBodyIds: next.bodyIds,
    selectedBlockIds: next.blockIds,
    selectedElementIds: next.elementIds,
    selectedFaces: next.faceRefs,
    selectedNodeIds: next.nodeIds,
    selectedEdges: next.edgeRefs,
  });
}

type PartTarget = Extract<InteractionTarget, { readonly kind: "part" }>;
type InstanceTarget = Extract<InteractionTarget, { readonly kind: "instance" }>;
type BodyTarget = Extract<InteractionTarget, { readonly kind: "body" }>;
type BlockTarget = Extract<InteractionTarget, { readonly kind: "block" }>;
type ElementTarget = Extract<InteractionTarget, { readonly kind: "element" }>;
type FaceTarget = Extract<InteractionTarget, { readonly kind: "face" }>;
type NodeTarget = Extract<InteractionTarget, { readonly kind: "node" }>;
type EdgeTarget = Extract<InteractionTarget, { readonly kind: "edge" }>;

interface TargetGroups {
  readonly partIds: Set<PartTarget["partId"]>;
  readonly instanceIds: Set<InstanceTarget["instanceId"]>;
  readonly bodyIds: Map<BodyTarget["instanceId"], Set<BodyTarget["bodyId"]>>;
  readonly blockIds: Map<BlockTarget["instanceId"], Set<BlockTarget["blockId"]>>;
  readonly elementIds: Map<ElementTarget["instanceId"], Set<ElementTarget["elementId"]>>;
  readonly faceRefs: Map<FaceTarget["instanceId"], Map<string, FaceRef>>;
  readonly nodeIds: Map<NodeTarget["instanceId"], Set<NodeTarget["nodeId"]>>;
  readonly edgeRefs: Map<EdgeTarget["instanceId"], Map<string, EdgeRef>>;
}

interface TargetCollections {
  readonly partIds: ReadonlySet<PartTarget["partId"]>;
  readonly instanceIds: ReadonlySet<InstanceTarget["instanceId"]>;
  readonly bodyIds: ReadonlyMap<BodyTarget["instanceId"], ReadonlySet<BodyTarget["bodyId"]>>;
  readonly blockIds: ReadonlyMap<BlockTarget["instanceId"], ReadonlySet<BlockTarget["blockId"]>>;
  readonly elementIds: ReadonlyMap<
    ElementTarget["instanceId"],
    ReadonlySet<ElementTarget["elementId"]>
  >;
  readonly faceRefs: ReadonlyMap<FaceTarget["instanceId"], ReadonlyMap<string, FaceRef>>;
  readonly nodeIds: ReadonlyMap<NodeTarget["instanceId"], ReadonlySet<NodeTarget["nodeId"]>>;
  readonly edgeRefs: ReadonlyMap<EdgeTarget["instanceId"], ReadonlyMap<string, EdgeRef>>;
}

function collectTargetGroups(targets: readonly InteractionTarget[]): TargetGroups {
  const groups: TargetGroups = {
    partIds: new Set(),
    instanceIds: new Set(),
    bodyIds: new Map(),
    blockIds: new Map(),
    elementIds: new Map(),
    faceRefs: new Map(),
    nodeIds: new Map(),
    edgeRefs: new Map(),
  };
  const seen = new Set<string>();
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    switch (target.kind) {
      case "part":
        groups.partIds.add(target.partId);
        break;
      case "instance":
        groups.instanceIds.add(target.instanceId);
        break;
      case "body":
        addNestedValue(groups.bodyIds, target.instanceId, target.bodyId);
        break;
      case "block":
        addNestedValue(groups.blockIds, target.instanceId, target.blockId);
        break;
      case "element":
        addNestedValue(groups.elementIds, target.instanceId, target.elementId);
        break;
      case "face": {
        const key = faceId(target.elementId, target.faceIndex);
        addNestedValue(groups.faceRefs, target.instanceId, key, target);
        break;
      }
      case "node":
        addNestedValue(groups.nodeIds, target.instanceId, target.nodeId);
        break;
      case "edge":
        addNestedValue(groups.edgeRefs, target.instanceId, target.key, target);
        break;
    }
  }
  return groups;
}

function selectedCollections(data: InteractionStateData): TargetCollections {
  return {
    partIds: data.selectedPartIds,
    instanceIds: data.selectedInstanceIds,
    bodyIds: data.selectedBodyIds,
    blockIds: data.selectedBlockIds,
    elementIds: data.selectedElementIds,
    faceRefs: data.selectedFaces,
    nodeIds: data.selectedNodeIds,
    edgeRefs: data.selectedEdges,
  };
}

function highlightedCollections(data: InteractionStateData): TargetCollections {
  return {
    partIds: data.highlightedPartIds,
    instanceIds: data.highlightedInstanceIds,
    bodyIds: data.highlightedBodyIds,
    blockIds: data.highlightedBlockIds,
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
    instanceIds: updateSetValues(current.instanceIds, groups.instanceIds, enabled),
    bodyIds: updateNestedSets(current.bodyIds, groups.bodyIds, enabled),
    blockIds: updateNestedSets(current.blockIds, groups.blockIds, enabled),
    elementIds: updateNestedSets(current.elementIds, groups.elementIds, enabled),
    faceRefs: updateNestedMaps(current.faceRefs, groups.faceRefs, enabled),
    nodeIds: updateNestedSets(current.nodeIds, groups.nodeIds, enabled),
    edgeRefs: updateNestedMaps(current.edgeRefs, groups.edgeRefs, enabled),
  };
}

function targetCollectionsEqual(left: TargetCollections, right: TargetCollections): boolean {
  return (
    left.partIds === right.partIds &&
    left.instanceIds === right.instanceIds &&
    left.bodyIds === right.bodyIds &&
    left.blockIds === right.blockIds &&
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

function targetKey(target: InteractionTarget): string {
  switch (target.kind) {
    case "part":
      return `part:${target.partId}`;
    case "instance":
      return `instance:${target.instanceId}`;
    case "body":
      return `body:${target.instanceId}:${target.bodyId}`;
    case "block":
      return `block:${target.instanceId}:${target.blockId}`;
    case "element":
      return `element:${target.instanceId}:${target.elementId}`;
    case "face":
      return `face:${target.instanceId}:${faceId(target.elementId, target.faceIndex)}`;
    case "node":
      return `node:${target.instanceId}:${target.nodeId}`;
    case "edge":
      return `edge:${target.instanceId}:${target.key}`;
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
    highlightedInstanceIds: next.instanceIds,
    highlightedBodyIds: next.bodyIds,
    highlightedBlockIds: next.blockIds,
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
    case "instance":
      return data.selectedInstanceIds.has(target.instanceId);
    case "body":
      return data.selectedBodyIds.get(target.instanceId)?.has(target.bodyId) === true;
    case "block":
      return data.selectedBlockIds.get(target.instanceId)?.has(target.blockId) === true;
    case "element":
      return data.selectedElementIds.get(target.instanceId)?.has(target.elementId) === true;
    case "face": {
      const key = faceId(target.elementId, target.faceIndex);
      return data.selectedFaces.get(target.instanceId)?.has(key) === true;
    }
    case "node":
      return data.selectedNodeIds.get(target.instanceId)?.has(target.nodeId) === true;
    case "edge":
      return data.selectedEdges.get(target.instanceId)?.has(target.key) === true;
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
    case "instance":
      return data.highlightedInstanceIds.has(target.instanceId);
    case "body":
      return data.highlightedBodyIds.get(target.instanceId)?.has(target.bodyId) === true;
    case "block":
      return data.highlightedBlockIds.get(target.instanceId)?.has(target.blockId) === true;
    case "element":
      return data.highlightedElementIds.get(target.instanceId)?.has(target.elementId) === true;
    case "face": {
      const key = faceId(target.elementId, target.faceIndex);
      return data.highlightedFaces.get(target.instanceId)?.has(key) === true;
    }
    case "node":
      return data.highlightedNodeIds.get(target.instanceId)?.has(target.nodeId) === true;
    case "edge":
      return data.highlightedEdges.get(target.instanceId)?.has(target.key) === true;
  }
}

/** Returns whether a target is the one currently hovered target. */
export { hoveredTarget, isHoveredTarget };
