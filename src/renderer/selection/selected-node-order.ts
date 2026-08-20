import type { Part, PartId } from "../../geometry/part";
import { sortedNumbers, sortedStringMapEntries } from "../../interaction/mechanics";
import { readInteractionState, type InteractionState } from "../../interaction/state";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { InstanceLayout } from "../runtime-state";
import { isValidNodeId, partNodeCount } from "./node-selection";

/**
 * One part's selected-node presentation orders. Sparse membership is stored as
 * paired occurrence slots and node ids; near-complete membership uses the
 * existing full-node path because its one-slot order is cheaper to upload.
 */
export interface SelectedNodeOrder {
  readonly denseOccurrences: Uint32Array;
  readonly sparseOccurrences: Uint32Array;
  readonly sparseNodeIds: Uint32Array;
}

const EMPTY_ORDER: SelectedNodeOrder = {
  denseOccurrences: new Uint32Array(),
  sparseOccurrences: new Uint32Array(),
  sparseNodeIds: new Uint32Array(),
};

// A sparse row costs two u32s while a dense row costs one. Only a selection
// within one eighth of complete may trade its exact submitted-node count for
// that lower retained/upload cost; a small selection can never take this path.
const DENSE_NUMERATOR = 7;
const DENSE_DENOMINATOR = 8;

/** Builds one shared selected-node order consumed by visible and x-ray passes. */
export function buildSelectedNodeOrder(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly partId: PartId;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
}): SelectedNodeOrder {
  const part = options.parts.get(options.partId);
  const nodeCount = part === undefined ? 0 : partNodeCount(part);
  if (nodeCount === 0 || part?.geometries.every((geometry) => geometry.primitive === "points")) {
    return EMPTY_ORDER;
  }
  const dense: number[] = [];
  const sparseOccurrences: number[] = [];
  const sparseNodeIds: number[] = [];
  const data = readInteractionState(options.interaction);
  for (const [instanceId, selected] of sortedStringMapEntries(data.selectedNodeIds)) {
    const slot = options.runtime.getInstanceSlot(instanceId);
    if (
      slot === undefined ||
      !options.runtime.isInstanceVisible(slot) ||
      options.runtime.instancePartIds[slot] !== options.partId
    )
      continue;
    const local = options.layout.slotPartLocal[slot];
    if (local === undefined || local < 0) continue;
    const ids = sortedValidNodeIds(selected, nodeCount);
    if (ids.length === 0) continue;
    if (usesDenseReplay(ids.length, nodeCount)) {
      dense.push(local);
      continue;
    }
    for (const nodeId of ids) {
      sparseOccurrences.push(local);
      sparseNodeIds.push(nodeId);
    }
  }
  return {
    denseOccurrences: new Uint32Array(dense),
    sparseOccurrences: new Uint32Array(sparseOccurrences),
    sparseNodeIds: new Uint32Array(sparseNodeIds),
  };
}

function sortedValidNodeIds(selected: ReadonlySet<number>, nodeCount: number): number[] {
  const ids: number[] = [];
  for (const nodeId of sortedNumbers(selected))
    if (isValidNodeId(nodeId, nodeCount)) ids.push(nodeId);
  return ids;
}

function usesDenseReplay(selectedCount: number, nodeCount: number): boolean {
  return selectedCount * DENSE_DENOMINATOR >= nodeCount * DENSE_NUMERATOR;
}
