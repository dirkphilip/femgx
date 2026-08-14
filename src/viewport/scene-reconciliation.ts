import type { Part, PartId } from "../geometry/part";
import {
  createInteractionStateValue,
  readInteractionState,
  type InteractionState,
  type InteractionStateData,
} from "../interaction/state";
import type { InteractionTarget } from "../interaction/target-types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";

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
  const keepInstance = (instanceId: string): boolean =>
    runtime.getInstanceSlot(instanceId) !== undefined;
  const keepPart = (partId: PartId): boolean => parts.has(partId);
  const { hoveredTarget: previousHoveredTarget, ...dataWithoutHover } = data;
  const nextHoveredTarget = targetInScene(previousHoveredTarget, keepPart, keepInstance);
  const nextWithoutHover: Omit<InteractionStateData, "hoveredTarget"> = {
    ...dataWithoutHover,
    highlightedPartIds: filterSet(data.highlightedPartIds, keepPart),
    selectedPartIds: filterSet(data.selectedPartIds, keepPart),
    highlightedInstanceIds: filterSet(data.highlightedInstanceIds, keepInstance),
    selectedInstanceIds: filterSet(data.selectedInstanceIds, keepInstance),
    selectedBodyIds: filterOuterMap(data.selectedBodyIds, keepInstance),
    highlightedBodyIds: filterOuterMap(data.highlightedBodyIds, keepInstance),
    bodyOverrides: filterOuterMap(data.bodyOverrides, keepInstance),
    hiddenBodyIds: filterOuterMap(data.hiddenBodyIds, keepInstance),
    selectedBlockIds: filterOuterMap(data.selectedBlockIds, keepInstance),
    highlightedBlockIds: filterOuterMap(data.highlightedBlockIds, keepInstance),
    hiddenBlockIds: filterOuterMap(data.hiddenBlockIds, keepInstance),
    blockOverrides: filterOuterMap(data.blockOverrides, keepInstance),
    selectedElementIds: filterOuterMap(data.selectedElementIds, keepInstance),
    highlightedElementIds: filterOuterMap(data.highlightedElementIds, keepInstance),
    hiddenElementIds: filterOuterMap(data.hiddenElementIds, keepInstance),
    elementOverrides: filterOuterMap(data.elementOverrides, keepInstance),
    instanceOverrides: filterMap(data.instanceOverrides, keepInstance),
    selectedNodeIds: filterOuterMap(data.selectedNodeIds, keepInstance),
    highlightedNodeIds: filterOuterMap(data.highlightedNodeIds, keepInstance),
    selectedFaces: filterOuterMap(data.selectedFaces, keepInstance),
    highlightedFaces: filterOuterMap(data.highlightedFaces, keepInstance),
    partOverrides: filterMap(data.partOverrides, keepPart),
  };
  const next: InteractionStateData =
    nextHoveredTarget === undefined
      ? nextWithoutHover
      : { ...nextWithoutHover, hoveredTarget: nextHoveredTarget };
  return sameInteractionData(data, next) ? state : createInteractionStateValue(next);
}

function targetInScene(
  target: InteractionTarget | undefined,
  keepPart: (partId: PartId) => boolean,
  keepInstance: (instanceId: string) => boolean,
): InteractionTarget | undefined {
  if (target === undefined) return undefined;
  return target.kind === "part"
    ? keepPart(target.partId)
      ? target
      : undefined
    : keepInstance(target.instanceId)
      ? target
      : undefined;
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

function filterOuterMap<K, V>(
  current: ReadonlyMap<K, V>,
  keep: (key: K) => boolean,
): ReadonlyMap<K, V> {
  return filterMap(current, keep);
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
    left.hoveredTarget === right.hoveredTarget
  );
}
