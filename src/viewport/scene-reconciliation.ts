import type { Part, PartId } from "../geometry/part";
import { getPartSemanticIndex, type PartSemanticIndex } from "../geometry/part-semantic-index";
import {
  createInteractionStateValue,
  readInteractionState,
  type InteractionState,
  type InteractionStateData,
} from "../interaction/state";
import type { InteractionTarget } from "../interaction/target-types";
import { faceIdentity as faceId } from "../geometry/element-face-selection";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartOccurrenceId } from "../scene/types";

/**
 * Carries viewport-local visibility and interaction identity across a packed
 * runtime replacement without exposing packed slots to the public API.
 */
export function preserveRuntimeVisibility(
  previous: PackedSceneRuntime,
  next: PackedSceneRuntime,
): void {
  const partVisibility = new Map<PartId, boolean>();
  for (let slot = 0; slot < previous.instanceCount; slot += 1) {
    const partId = previous.getPartId(slot);
    if (partId !== undefined && !partVisibility.has(partId)) {
      partVisibility.set(partId, previous.instancePartVisible[slot] === 1);
    }
  }
  for (const [partId, visible] of partVisibility) next.setPartVisible(partId, visible);

  for (let node = 0; node < next.nodeCount; node += 1) {
    const occurrenceId = next.getNodeId(node);
    const previousNode =
      occurrenceId === undefined ? undefined : previous.getNodeSlot(occurrenceId);
    if (previousNode !== undefined) {
      next.setAssemblyNodeVisible(node, previous.nodeVisible[previousNode] === 1);
    }
  }

  for (let slot = 0; slot < next.instanceCount; slot += 1) {
    const partOccurrenceId = next.getInstanceId(slot);
    const previousSlot =
      partOccurrenceId === undefined ? undefined : previous.getInstanceSlot(partOccurrenceId);
    if (previousSlot !== undefined) {
      next.setInstanceVisible(slot, previous.instanceOverrideVisible[previousSlot] === 1);
    }
  }
}

/** Removes references to parts and placement occurrences absent from a scene. */
export function reconcileInteractionState(
  state: InteractionState,
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<PartId, Part>,
): InteractionState {
  const data = readInteractionState(state);
  const identityCache = new Map<PartOccurrenceId, SceneIdentity | undefined>();
  const identityFor = (partOccurrenceId: PartOccurrenceId): SceneIdentity | undefined => {
    if (!identityCache.has(partOccurrenceId)) {
      identityCache.set(partOccurrenceId, sceneIdentity(partOccurrenceId, runtime, parts));
    }
    return identityCache.get(partOccurrenceId);
  };
  const keepInstance = (partOccurrenceId: PartOccurrenceId): boolean =>
    identityFor(partOccurrenceId) !== undefined;
  const keepPart = (partId: PartId): boolean => parts.has(partId);
  const { hoveredTarget: previousHoveredTarget, ...dataWithoutHover } = data;
  const nextHoveredTarget = targetInScene(previousHoveredTarget, keepPart, identityFor);
  const nextWithoutHover: Omit<InteractionStateData, "hoveredTarget"> = {
    ...dataWithoutHover,
    ...reconcilePartState(data, keepPart),
    ...reconcileOccurrenceState(data, identityFor, keepInstance),
  };
  const next: InteractionStateData =
    nextHoveredTarget === undefined
      ? nextWithoutHover
      : { ...nextWithoutHover, hoveredTarget: nextHoveredTarget };
  return sameInteractionData(data, next) ? state : createInteractionStateValue(next);
}

function reconcilePartState(
  data: InteractionStateData,
  keepPart: (partId: PartId) => boolean,
): Pick<InteractionStateData, "highlightedPartIds" | "selectedPartIds" | "partOverrides"> {
  return {
    highlightedPartIds: filterSet(data.highlightedPartIds, keepPart),
    selectedPartIds: filterSet(data.selectedPartIds, keepPart),
    partOverrides: filterMap(data.partOverrides, keepPart),
  };
}

type ReconciledOccurrenceState = Pick<
  InteractionStateData,
  | "highlightedPartOccurrenceIds"
  | "selectedPartOccurrenceIds"
  | "selectedBodyIds"
  | "highlightedBodyIds"
  | "bodyOverrides"
  | "hiddenBodyIds"
  | "selectedElementIds"
  | "highlightedElementIds"
  | "hiddenElementIds"
  | "elementOverrides"
  | "partOccurrenceOverrides"
  | "selectedNodeIds"
  | "highlightedNodeIds"
  | "selectedFaces"
  | "highlightedFaces"
  | "selectedEdges"
  | "highlightedEdges"
>;

function reconcileOccurrenceState(
  data: InteractionStateData,
  identityFor: (partOccurrenceId: PartOccurrenceId) => SceneIdentity | undefined,
  keepInstance: (partOccurrenceId: PartOccurrenceId) => boolean,
): ReconciledOccurrenceState {
  const body = (owner: SceneIdentity, id: number): boolean => owner.semantic.bodies.has(id);
  const element = (owner: SceneIdentity, id: number): boolean => owner.semantic.elements.has(id);
  const node = (owner: SceneIdentity, id: number): boolean =>
    id >= 0 && id < owner.semantic.nodeCount;
  const face = (
    owner: SceneIdentity,
    key: string,
    ref: { readonly elementId: number; readonly faceIndex: number },
  ): boolean => owner.semantic.faces.has(key) && faceId(ref.elementId, ref.faceIndex) === key;
  const edge = (owner: SceneIdentity, key: string): boolean => owner.semantic.edges.has(key);
  return {
    highlightedPartOccurrenceIds: filterSet(data.highlightedPartOccurrenceIds, keepInstance),
    selectedPartOccurrenceIds: filterSet(data.selectedPartOccurrenceIds, keepInstance),
    selectedBodyIds: filterNested(data.selectedBodyIds, identityFor, body),
    highlightedBodyIds: filterNested(data.highlightedBodyIds, identityFor, body),
    bodyOverrides: filterNestedMaps(data.bodyOverrides, identityFor, body),
    hiddenBodyIds: filterNested(data.hiddenBodyIds, identityFor, body),
    selectedElementIds: filterNested(data.selectedElementIds, identityFor, element),
    highlightedElementIds: filterNested(data.highlightedElementIds, identityFor, element),
    hiddenElementIds: filterNested(data.hiddenElementIds, identityFor, element),
    elementOverrides: filterNestedMaps(data.elementOverrides, identityFor, element),
    partOccurrenceOverrides: filterMap(data.partOccurrenceOverrides, keepInstance),
    selectedNodeIds: filterNested(data.selectedNodeIds, identityFor, node),
    highlightedNodeIds: filterNested(data.highlightedNodeIds, identityFor, node),
    selectedFaces: filterNestedMaps(data.selectedFaces, identityFor, face),
    highlightedFaces: filterNestedMaps(data.highlightedFaces, identityFor, face),
    selectedEdges: filterNestedMaps(data.selectedEdges, identityFor, edge),
    highlightedEdges: filterNestedMaps(data.highlightedEdges, identityFor, edge),
  };
}

function targetInScene(
  target: InteractionTarget | undefined,
  keepPart: (partId: PartId) => boolean,
  identityFor: (partOccurrenceId: PartOccurrenceId) => SceneIdentity | undefined,
): InteractionTarget | undefined {
  if (target === undefined) return undefined;
  if (target.kind === "part") return keepPart(target.partId) ? target : undefined;
  const owner = identityFor(target.partOccurrenceId);
  if (owner === undefined) return undefined;
  if (target.kind === "partOccurrence") return target;
  if (target.kind === "body") return owner.semantic.bodies.has(target.bodyId) ? target : undefined;
  if (target.kind === "element") {
    return owner.semantic.elements.has(target.elementId) ? target : undefined;
  }
  if (target.kind === "node") {
    return target.nodeId >= 0 && target.nodeId < owner.semantic.nodeCount ? target : undefined;
  }
  if (target.kind === "face") {
    const key = faceId(target.elementId, target.faceIndex);
    return owner.semantic.faces.has(key) ? target : undefined;
  }
  return owner.semantic.edges.has(target.key) ? target : undefined;
}

function filterSet<T>(current: ReadonlySet<T>, keep: (value: T) => boolean): ReadonlySet<T> {
  let changed = false;
  const next = new Set<T>();
  for (const value of current) {
    if (keep(value)) next.add(value);
    else changed = true;
  }
  return changed ? next : current;
}

function filterMap<K, V>(current: ReadonlyMap<K, V>, keep: (key: K) => boolean): ReadonlyMap<K, V> {
  let changed = false;
  const next = new Map<K, V>();
  for (const [key, value] of current) {
    if (keep(key)) next.set(key, value);
    else changed = true;
  }
  return changed ? next : current;
}

interface SceneIdentity {
  readonly semantic: PartSemanticIndex;
}

function sceneIdentity(
  partOccurrenceId: PartOccurrenceId,
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<PartId, Part>,
): SceneIdentity | undefined {
  const slot = runtime.getInstanceSlot(partOccurrenceId);
  if (slot === undefined) return undefined;
  const partId = runtime.getPartId(slot);
  const part = partId === undefined ? undefined : parts.get(partId);
  return part === undefined ? undefined : { semantic: getPartSemanticIndex(part) };
}

function filterNestedMaps<K, V>(
  current: ReadonlyMap<PartOccurrenceId, ReadonlyMap<K, V>>,
  identityFor: (partOccurrenceId: PartOccurrenceId) => SceneIdentity | undefined,
  keep: (owner: SceneIdentity, key: K, value: V) => boolean,
): ReadonlyMap<PartOccurrenceId, ReadonlyMap<K, V>> {
  let changed = false;
  const next = new Map<PartOccurrenceId, ReadonlyMap<K, V>>();
  for (const [partOccurrenceId, values] of current) {
    const owner = identityFor(partOccurrenceId);
    if (owner === undefined) {
      changed = true;
      continue;
    }
    const filtered = new Map<K, V>();
    for (const [key, value] of values) {
      if (keep(owner, key, value)) filtered.set(key, value);
      else changed = true;
    }
    if (filtered.size > 0)
      next.set(partOccurrenceId, filtered.size === values.size ? values : filtered);
    else changed = true;
  }
  return changed ? next : current;
}

function filterNested<K>(
  current: ReadonlyMap<PartOccurrenceId, ReadonlySet<K>>,
  identityFor: (partOccurrenceId: PartOccurrenceId) => SceneIdentity | undefined,
  keep: (owner: SceneIdentity, value: K) => boolean,
): ReadonlyMap<PartOccurrenceId, ReadonlySet<K>> {
  let changed = false;
  const next = new Map<PartOccurrenceId, ReadonlySet<K>>();
  for (const [partOccurrenceId, values] of current) {
    const owner = identityFor(partOccurrenceId);
    if (owner === undefined) {
      changed = true;
      continue;
    }
    const filtered = new Set<K>();
    for (const value of values) {
      if (keep(owner, value)) filtered.add(value);
      else changed = true;
    }
    if (filtered.size > 0)
      next.set(partOccurrenceId, filtered.size === values.size ? values : filtered);
    else changed = true;
  }
  return changed ? next : current;
}

function sameInteractionData(left: InteractionStateData, right: InteractionStateData): boolean {
  return (
    left.highlightedPartIds === right.highlightedPartIds &&
    left.selectedPartIds === right.selectedPartIds &&
    left.highlightedPartOccurrenceIds === right.highlightedPartOccurrenceIds &&
    left.selectedPartOccurrenceIds === right.selectedPartOccurrenceIds &&
    left.selectedBodyIds === right.selectedBodyIds &&
    left.highlightedBodyIds === right.highlightedBodyIds &&
    left.bodyOverrides === right.bodyOverrides &&
    left.hiddenBodyIds === right.hiddenBodyIds &&
    left.selectedElementIds === right.selectedElementIds &&
    left.highlightedElementIds === right.highlightedElementIds &&
    left.hiddenElementIds === right.hiddenElementIds &&
    left.elementOverrides === right.elementOverrides &&
    left.partOverrides === right.partOverrides &&
    left.partOccurrenceOverrides === right.partOccurrenceOverrides &&
    left.selectedNodeIds === right.selectedNodeIds &&
    left.highlightedNodeIds === right.highlightedNodeIds &&
    left.selectedFaces === right.selectedFaces &&
    left.highlightedFaces === right.highlightedFaces &&
    left.selectedEdges === right.selectedEdges &&
    left.highlightedEdges === right.highlightedEdges &&
    left.hoveredTarget === right.hoveredTarget
  );
}
