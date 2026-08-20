import type { BodyRef } from "./refs";
import {
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type StyleOverride,
} from "./state";
import type { InteractionTarget } from "./target-types";

/** Bounded aggregate selection metadata for presentation-level queries. */
export interface SelectedTargetSummary {
  readonly count: number;
  readonly partIds: ReadonlySet<number>;
  readonly partOccurrenceIds: ReadonlySet<string>;
}

type SelectedElementTarget = Extract<InteractionTarget, { readonly kind: "element" }>;

/** Returns selected element occurrences in deterministic occurrence/id order. */
export function selectedElementTargets(state: InteractionState): SelectedElementTarget[] {
  const data = readInteractionState(state);
  const targets: SelectedElementTarget[] = [];
  for (const [partOccurrenceId, elementIds] of [...data.selectedElementIds.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    for (const elementId of [...elementIds].sort((left, right) => left - right)) {
      targets.push({ kind: "element", partOccurrenceId, elementId });
    }
  }
  return targets;
}

/** Counts selected elements that are not hidden without materializing targets. */
export function visibleSelectedElementCount(state: InteractionState): number {
  const data = readInteractionState(state);
  let count = 0;
  for (const [partOccurrenceId, elementIds] of data.selectedElementIds) {
    const hidden = data.hiddenElementIds.get(partOccurrenceId);
    for (const elementId of elementIds) if (hidden?.has(elementId) !== true) count += 1;
  }
  return count;
}

/** Counts selected identities and occurrences without materializing or sorting them. */
export function selectedTargetSummary(state: InteractionState): SelectedTargetSummary {
  const data = readInteractionState(state);
  const partOccurrenceIds = new Set(data.selectedPartOccurrenceIds);
  for (const groups of [
    data.selectedBodyIds,
    data.selectedElementIds,
    data.selectedFaces,
    data.selectedNodeIds,
    data.selectedEdges,
  ]) {
    for (const partOccurrenceId of groups.keys()) partOccurrenceIds.add(partOccurrenceId);
  }
  return { count: selectedTargetCount(state), partIds: data.selectedPartIds, partOccurrenceIds };
}

/** Counts all selected targets, or only targets of one interaction kind. */
export function selectedTargetCount(
  state: InteractionState,
  kind?: InteractionTarget["kind"],
): number {
  const data = readInteractionState(state);
  if (kind === "part") return data.selectedPartIds.size;
  if (kind === "partOccurrence") return data.selectedPartOccurrenceIds.size;
  const nested = {
    body: data.selectedBodyIds,
    element: data.selectedElementIds,
    face: data.selectedFaces,
    node: data.selectedNodeIds,
    edge: data.selectedEdges,
  };
  if (kind !== undefined) return nestedValueCount(nested[kind]);
  let count = data.selectedPartIds.size + data.selectedPartOccurrenceIds.size;
  for (const groups of Object.values(nested)) count += nestedValueCount(groups);
  return count;
}

function nestedValueCount(groups: ReadonlyMap<string, { readonly size: number }>): number {
  let count = 0;
  for (const values of groups.values()) count += values.size;
  return count;
}

/** Returns selected targets in stable kind and identity order. */
export function selectedTargets(state: InteractionState): InteractionTarget[] {
  const data = readInteractionState(state);
  const targets: InteractionTarget[] = [];
  for (const partId of [...data.selectedPartIds].sort((a, b) => a - b)) {
    targets.push({ kind: "part", partId });
  }
  for (const partOccurrenceId of [...data.selectedPartOccurrenceIds].sort()) {
    targets.push({ kind: "partOccurrence", partOccurrenceId });
  }
  appendNumericTargets(targets, data.selectedBodyIds, "body");
  appendNumericTargets(targets, data.selectedElementIds, "element");
  for (const [, faces] of [...data.selectedFaces.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const ref of [...faces.values()].sort(
      (a, b) =>
        a.partOccurrenceId.localeCompare(b.partOccurrenceId) ||
        a.elementId - b.elementId ||
        a.faceIndex - b.faceIndex,
    )) {
      targets.push({
        kind: "face",
        partOccurrenceId: ref.partOccurrenceId,
        elementId: ref.elementId,
        faceIndex: ref.faceIndex,
      });
    }
  }
  appendNumericTargets(targets, data.selectedNodeIds, "node");
  for (const [partOccurrenceId, edges] of [...data.selectedEdges.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const key of [...edges.keys()].sort())
      targets.push({ kind: "edge", partOccurrenceId, key });
  }
  return targets;
}

function appendNumericTargets(
  targets: InteractionTarget[],
  groups: ReadonlyMap<string, ReadonlySet<number>>,
  kind: "body" | "element" | "node",
): void {
  for (const [partOccurrenceId, ids] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const id of [...ids].sort((a, b) => a - b)) {
      switch (kind) {
        case "body":
          targets.push({ kind, partOccurrenceId, bodyId: id });
          break;
        case "element":
          targets.push({ kind, partOccurrenceId, elementId: id });
          break;
        case "node":
          targets.push({ kind, partOccurrenceId, nodeId: id });
          break;
      }
    }
  }
}

/** Returns an explicit body style override, if one is present. */
export function bodyOverride(state: InteractionState, ref: BodyRef): StyleOverride | undefined {
  return readInteractionState(state).bodyOverrides.get(ref.partOccurrenceId)?.get(ref.bodyId);
}

/** Clears all selection collections while preserving every other state layer. */
export function clearSelection(state: InteractionState): InteractionState {
  const data = readInteractionState(state);
  if (
    data.selectedPartIds.size === 0 &&
    data.selectedPartOccurrenceIds.size === 0 &&
    data.selectedBodyIds.size === 0 &&
    data.selectedElementIds.size === 0 &&
    data.selectedFaces.size === 0 &&
    data.selectedNodeIds.size === 0 &&
    data.selectedEdges.size === 0
  ) {
    return state;
  }
  return updateInteractionState(state, {
    selectedPartIds: new Set(),
    selectedPartOccurrenceIds: new Set(),
    selectedBodyIds: new Map(),
    selectedElementIds: new Map(),
    selectedFaces: new Map(),
    selectedNodeIds: new Map(),
    selectedEdges: new Map(),
  });
}
