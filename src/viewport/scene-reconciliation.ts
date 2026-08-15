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
import type { InstanceId } from "../scene/types";

/**
 * Carries viewport-local visibility and interaction identity across a packed
 * runtime replacement without exposing packed slots to the public API.
 */
export function preserveRuntimeVisibility(
  previous: PackedSceneRuntime,
  next: PackedSceneRuntime,
): void {
  for (let slot = 0; slot < next.instanceCount; slot += 1) {
    const instanceId = next.getInstanceId(slot);
    const previousSlot =
      instanceId === undefined ? undefined : previous.getInstanceSlot(instanceId);
    if (previousSlot !== undefined) {
      next.setInstanceVisible(slot, previous.isInstanceVisible(previousSlot));
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
  const identityCache = new Map<InstanceId, SceneIdentity | undefined>();
  const identityFor = (instanceId: InstanceId): SceneIdentity | undefined => {
    if (!identityCache.has(instanceId)) {
      identityCache.set(instanceId, sceneIdentity(instanceId, runtime, parts));
    }
    return identityCache.get(instanceId);
  };
  const keepInstance = (instanceId: InstanceId): boolean => identityFor(instanceId) !== undefined;
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
  | "highlightedInstanceIds"
  | "selectedInstanceIds"
  | "selectedBodyIds"
  | "highlightedBodyIds"
  | "bodyOverrides"
  | "hiddenBodyIds"
  | "selectedBlockIds"
  | "highlightedBlockIds"
  | "hiddenBlockIds"
  | "blockOverrides"
  | "selectedElementIds"
  | "highlightedElementIds"
  | "hiddenElementIds"
  | "elementOverrides"
  | "instanceOverrides"
  | "selectedNodeIds"
  | "highlightedNodeIds"
  | "selectedFaces"
  | "highlightedFaces"
  | "selectedEdges"
  | "highlightedEdges"
>;

function reconcileOccurrenceState(
  data: InteractionStateData,
  identityFor: (instanceId: InstanceId) => SceneIdentity | undefined,
  keepInstance: (instanceId: InstanceId) => boolean,
): ReconciledOccurrenceState {
  const body = (owner: SceneIdentity, id: number): boolean => owner.semantic.bodies.has(id);
  const block = (owner: SceneIdentity, id: number): boolean => owner.semantic.blocks.has(id);
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
    highlightedInstanceIds: filterSet(data.highlightedInstanceIds, keepInstance),
    selectedInstanceIds: filterSet(data.selectedInstanceIds, keepInstance),
    selectedBodyIds: filterNested(data.selectedBodyIds, identityFor, body),
    highlightedBodyIds: filterNested(data.highlightedBodyIds, identityFor, body),
    bodyOverrides: filterNestedMaps(data.bodyOverrides, identityFor, body),
    hiddenBodyIds: filterNested(data.hiddenBodyIds, identityFor, body),
    selectedBlockIds: filterNested(data.selectedBlockIds, identityFor, block),
    highlightedBlockIds: filterNested(data.highlightedBlockIds, identityFor, block),
    hiddenBlockIds: filterNested(data.hiddenBlockIds, identityFor, block),
    blockOverrides: filterNestedMaps(data.blockOverrides, identityFor, block),
    selectedElementIds: filterNested(data.selectedElementIds, identityFor, element),
    highlightedElementIds: filterNested(data.highlightedElementIds, identityFor, element),
    hiddenElementIds: filterNested(data.hiddenElementIds, identityFor, element),
    elementOverrides: filterNestedMaps(data.elementOverrides, identityFor, element),
    instanceOverrides: filterMap(data.instanceOverrides, keepInstance),
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
  identityFor: (instanceId: InstanceId) => SceneIdentity | undefined,
): InteractionTarget | undefined {
  if (target === undefined) return undefined;
  if (target.kind === "part") return keepPart(target.partId) ? target : undefined;
  const owner = identityFor(target.instanceId);
  if (owner === undefined) return undefined;
  if (target.kind === "instance") return target;
  if (target.kind === "body") return owner.semantic.bodies.has(target.bodyId) ? target : undefined;
  if (target.kind === "block")
    return owner.semantic.blocks.has(target.blockId) ? target : undefined;
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
  instanceId: InstanceId,
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<PartId, Part>,
): SceneIdentity | undefined {
  const slot = runtime.getInstanceSlot(instanceId);
  if (slot === undefined) return undefined;
  const partId = runtime.getPartId(slot);
  const part = partId === undefined ? undefined : parts.get(partId);
  return part === undefined ? undefined : { semantic: getPartSemanticIndex(part) };
}

function filterNestedMaps<K, V>(
  current: ReadonlyMap<InstanceId, ReadonlyMap<K, V>>,
  identityFor: (instanceId: InstanceId) => SceneIdentity | undefined,
  keep: (owner: SceneIdentity, key: K, value: V) => boolean,
): ReadonlyMap<InstanceId, ReadonlyMap<K, V>> {
  let changed = false;
  const next = new Map<InstanceId, ReadonlyMap<K, V>>();
  for (const [instanceId, values] of current) {
    const owner = identityFor(instanceId);
    if (owner === undefined) {
      changed = true;
      continue;
    }
    const filtered = new Map<K, V>();
    for (const [key, value] of values) {
      if (keep(owner, key, value)) filtered.set(key, value);
      else changed = true;
    }
    if (filtered.size > 0) next.set(instanceId, filtered.size === values.size ? values : filtered);
    else changed = true;
  }
  return changed ? next : current;
}

function filterNested<K>(
  current: ReadonlyMap<InstanceId, ReadonlySet<K>>,
  identityFor: (instanceId: InstanceId) => SceneIdentity | undefined,
  keep: (owner: SceneIdentity, value: K) => boolean,
): ReadonlyMap<InstanceId, ReadonlySet<K>> {
  let changed = false;
  const next = new Map<InstanceId, ReadonlySet<K>>();
  for (const [instanceId, values] of current) {
    const owner = identityFor(instanceId);
    if (owner === undefined) {
      changed = true;
      continue;
    }
    const filtered = new Set<K>();
    for (const value of values) {
      if (keep(owner, value)) filtered.add(value);
      else changed = true;
    }
    if (filtered.size > 0) next.set(instanceId, filtered.size === values.size ? values : filtered);
    else changed = true;
  }
  return changed ? next : current;
}

function sameInteractionData(left: InteractionStateData, right: InteractionStateData): boolean {
  return (
    left.highlightedPartIds === right.highlightedPartIds &&
    left.selectedPartIds === right.selectedPartIds &&
    left.highlightedInstanceIds === right.highlightedInstanceIds &&
    left.selectedInstanceIds === right.selectedInstanceIds &&
    left.selectedBodyIds === right.selectedBodyIds &&
    left.highlightedBodyIds === right.highlightedBodyIds &&
    left.bodyOverrides === right.bodyOverrides &&
    left.hiddenBodyIds === right.hiddenBodyIds &&
    left.selectedBlockIds === right.selectedBlockIds &&
    left.highlightedBlockIds === right.highlightedBlockIds &&
    left.hiddenBlockIds === right.hiddenBlockIds &&
    left.blockOverrides === right.blockOverrides &&
    left.selectedElementIds === right.selectedElementIds &&
    left.highlightedElementIds === right.highlightedElementIds &&
    left.hiddenElementIds === right.hiddenElementIds &&
    left.elementOverrides === right.elementOverrides &&
    left.partOverrides === right.partOverrides &&
    left.instanceOverrides === right.instanceOverrides &&
    left.selectedNodeIds === right.selectedNodeIds &&
    left.highlightedNodeIds === right.highlightedNodeIds &&
    left.selectedFaces === right.selectedFaces &&
    left.highlightedFaces === right.highlightedFaces &&
    left.selectedEdges === right.selectedEdges &&
    left.highlightedEdges === right.highlightedEdges &&
    left.hoveredTarget === right.hoveredTarget
  );
}
