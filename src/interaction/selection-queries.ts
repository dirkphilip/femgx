import type { BodyRef } from "./refs";
import {
  readInteractionState,
  readInteractionVisibility,
  updateInteractionState,
  withInteractionVisibility,
  type InteractionState,
  type StyleOverride,
} from "./state";
import { updateNestedSets } from "./mechanics";
import type { InteractionTarget } from "./target-types";
import type { ElementRef } from "../scene/types";

/** Bounded aggregate selection metadata for presentation-level queries. */
export interface SelectedTargetSummary {
  readonly count: number;
  readonly assemblyIds: ReadonlySet<number>;
  readonly assemblyOccurrenceIds: ReadonlySet<string>;
  readonly partIds: ReadonlySet<number>;
  readonly partOccurrenceIds: ReadonlySet<string>;
}

/** Aggregate selected-element visibility without materializing interaction targets. */
export interface SelectedElementVisibilitySummary {
  readonly selectedCount: number;
  readonly visibleCount: number;
}

/** Counts selected elements that remain visible across all occurrences. */
export function selectedElementVisibilitySummary(
  state: InteractionState,
  isVisible: (ref: ElementRef) => boolean = (ref) =>
    readInteractionVisibility(state)
      .hiddenElementIds.get(ref.partOccurrenceId)
      ?.has(ref.elementId) !== true,
): SelectedElementVisibilitySummary {
  const data = readInteractionState(state);
  let selectedCount = 0;
  let visibleCount = 0;
  for (const [partOccurrenceId, selectedIds] of data.selectedElementIds) {
    selectedCount += selectedIds.size;
    for (const elementId of selectedIds)
      if (isVisible({ partOccurrenceId, elementId })) visibleCount += 1;
  }
  return { selectedCount, visibleCount };
}

/** Hides every selected element through one immutable nested-set transition. */
export function hideSelectedElements(state: InteractionState): InteractionState {
  const data = readInteractionState(state);
  const visibility = readInteractionVisibility(state);
  const hiddenElementIds = updateNestedSets(
    visibility.hiddenElementIds,
    data.selectedElementIds,
    true,
  );
  return hiddenElementIds === visibility.hiddenElementIds
    ? state
    : withInteractionVisibility(state, { ...visibility, hiddenElementIds });
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
  return {
    count: selectedTargetCount(state),
    assemblyIds: data.selectedAssemblyIds,
    assemblyOccurrenceIds: data.selectedAssemblyOccurrenceIds,
    partIds: data.selectedPartIds,
    partOccurrenceIds,
  };
}

/** Counts all selected targets, or only targets of one interaction kind. */
export function selectedTargetCount(
  state: InteractionState,
  kind?: InteractionTarget["kind"],
): number {
  const data = readInteractionState(state);
  if (kind === "part") return data.selectedPartIds.size;
  if (kind === "partOccurrence") return data.selectedPartOccurrenceIds.size;
  if (kind === "assembly") return data.selectedAssemblyIds.size;
  if (kind === "assemblyOccurrence") return data.selectedAssemblyOccurrenceIds.size;
  if (kind === "body") return nestedValueCount(data.selectedBodyIds);
  if (kind === "element") return nestedValueCount(data.selectedElementIds);
  if (kind === "face") return nestedValueCount(data.selectedFaces);
  if (kind === "node") return nestedValueCount(data.selectedNodeIds);
  if (kind === "edge") return nestedValueCount(data.selectedEdges);
  const nested: ReadonlyArray<ReadonlyMap<string, { readonly size: number }>> = [
    data.selectedBodyIds,
    data.selectedElementIds,
    data.selectedFaces,
    data.selectedNodeIds,
    data.selectedEdges,
  ];
  let count =
    data.selectedAssemblyIds.size +
    data.selectedAssemblyOccurrenceIds.size +
    data.selectedPartIds.size +
    data.selectedPartOccurrenceIds.size;
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
  for (const assemblyId of [...data.selectedAssemblyIds].sort((a, b) => a - b)) {
    targets.push({ kind: "assembly", assemblyId });
  }
  for (const assemblyOccurrenceId of [...data.selectedAssemblyOccurrenceIds].sort()) {
    targets.push({ kind: "assemblyOccurrence", assemblyOccurrenceId });
  }
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
    data.selectedAssemblyIds.size === 0 &&
    data.selectedAssemblyOccurrenceIds.size === 0 &&
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
    selectedAssemblyIds: new Set(),
    selectedAssemblyOccurrenceIds: new Set(),
    selectedPartIds: new Set(),
    selectedPartOccurrenceIds: new Set(),
    selectedBodyIds: new Map(),
    selectedElementIds: new Map(),
    selectedFaces: new Map(),
    selectedNodeIds: new Map(),
    selectedEdges: new Map(),
  });
}
