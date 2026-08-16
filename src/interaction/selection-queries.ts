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
  readonly instanceIds: ReadonlySet<string>;
}

/** Counts selected identities and occurrences without materializing or sorting them. */
export function selectedTargetSummary(state: InteractionState): SelectedTargetSummary {
  const data = readInteractionState(state);
  const instanceIds = new Set(data.selectedInstanceIds);
  for (const groups of [
    data.selectedBodyIds,
    data.selectedBlockIds,
    data.selectedElementIds,
    data.selectedFaces,
    data.selectedNodeIds,
    data.selectedEdges,
  ]) {
    for (const instanceId of groups.keys()) instanceIds.add(instanceId);
  }
  return { count: selectedTargetCount(state), partIds: data.selectedPartIds, instanceIds };
}

/** Counts all selected targets, or only targets of one interaction kind. */
export function selectedTargetCount(
  state: InteractionState,
  kind?: InteractionTarget["kind"],
): number {
  const data = readInteractionState(state);
  if (kind === "part") return data.selectedPartIds.size;
  if (kind === "instance") return data.selectedInstanceIds.size;
  const nested = {
    body: data.selectedBodyIds,
    block: data.selectedBlockIds,
    element: data.selectedElementIds,
    face: data.selectedFaces,
    node: data.selectedNodeIds,
    edge: data.selectedEdges,
  };
  if (kind !== undefined) return nestedValueCount(nested[kind]);
  let count = data.selectedPartIds.size + data.selectedInstanceIds.size;
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
  for (const instanceId of [...data.selectedInstanceIds].sort()) {
    targets.push({ kind: "instance", instanceId });
  }
  appendNumericTargets(targets, data.selectedBodyIds, "body", "bodyId");
  appendNumericTargets(targets, data.selectedBlockIds, "block", "blockId");
  appendNumericTargets(targets, data.selectedElementIds, "element", "elementId");
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
  appendNumericTargets(targets, data.selectedNodeIds, "node", "nodeId");
  for (const [instanceId, edges] of [...data.selectedEdges.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const key of [...edges.keys()].sort()) targets.push({ kind: "edge", instanceId, key });
  }
  return targets;
}

function appendNumericTargets(
  targets: InteractionTarget[],
  groups: ReadonlyMap<string, ReadonlySet<number>>,
  kind: "body" | "block" | "element" | "node",
  property: "bodyId" | "blockId" | "elementId" | "nodeId",
): void {
  for (const [instanceId, ids] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const id of [...ids].sort((a, b) => a - b)) {
      targets.push({ kind, instanceId, [property]: id } as InteractionTarget);
    }
  }
}

/** Returns an explicit body style override, if one is present. */
export function bodyOverride(state: InteractionState, ref: BodyRef): StyleOverride | undefined {
  return readInteractionState(state).bodyOverrides.get(ref.instanceId)?.get(ref.bodyId);
}

/** Clears all selection collections while preserving every other state layer. */
export function clearSelection(state: InteractionState): InteractionState {
  const data = readInteractionState(state);
  if (
    data.selectedPartIds.size === 0 &&
    data.selectedInstanceIds.size === 0 &&
    data.selectedBodyIds.size === 0 &&
    data.selectedBlockIds.size === 0 &&
    data.selectedElementIds.size === 0 &&
    data.selectedFaces.size === 0 &&
    data.selectedNodeIds.size === 0 &&
    data.selectedEdges.size === 0
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
    selectedEdges: new Map(),
  });
}
