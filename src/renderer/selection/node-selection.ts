import type { Part, PartId } from "../../geometry/part";
import {
  collectUniqueRefs,
  sortedNumbers,
  sortedStringMapEntries,
} from "../../interaction/mechanics";
import type { InteractionState } from "../../interaction/interaction";
import { readInteractionState, type InteractionStateData } from "../../interaction/state";
import type { NodeRef } from "../../interaction/refs";
import type { PartOccurrenceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { ELEMENT_RECORD_STRIDE } from "./highlight-layout";
import {
  denseMembershipContains,
  denseMembershipOccurrenceAtSlot as denseNodeOccurrenceAtSlot,
  sortDenseMembershipOccurrences,
  type DenseMembership,
  type DenseMembershipLayout,
  type DenseMembershipOccurrence,
} from "./dense-membership";

/** The stable layout fields required to resolve dense node selections. */
export type DenseNodeLayout = DenseMembershipLayout;

/** One part-local occurrence's dense selected-node membership. */
export type DenseNodeOccurrence = DenseMembershipOccurrence;

/** All dense selected-node membership for one reusable part. */
export interface DenseNodeSelection extends DenseMembership {
  readonly nodeCount: number;
  readonly occurrences: readonly DenseNodeOccurrence[];
}

/** Dense selected-node membership grouped by reusable part. */
export type DenseNodeSelections = ReadonlyMap<PartId, DenseNodeSelection>;

interface DenseNodeCacheEntry {
  readonly selectedIds: InteractionStateData["selectedNodeIds"];
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly selections: DenseNodeSelections;
}

const selectionCache = new WeakMap<
  PackedSceneRuntime,
  WeakMap<DenseNodeLayout, DenseNodeCacheEntry>
>();

/** Resolves valid large node selections to compact typed bitsets. */
export function collectDenseNodeSelections(
  runtime: PackedSceneRuntime,
  layout: DenseNodeLayout,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
): DenseNodeSelections {
  const data = readInteractionState(interaction);
  const runtimeCache = selectionCache.get(runtime);
  const cached = runtimeCache?.get(layout);
  if (cached?.selectedIds === data.selectedNodeIds && cached.parts === parts) {
    return cached.selections;
  }
  const byPart = new Map<PartId, DenseNodeBuilder>();
  const context: DenseNodeContext = { runtime, layout, parts, byPart };
  for (const [instanceId, nodeIds] of data.selectedNodeIds) {
    addInstanceSelection(context, instanceId, nodeIds);
  }
  const selections = new Map<PartId, DenseNodeSelection>();
  for (const [partId, candidate] of byPart) {
    const occurrences = denseOccurrences(candidate);
    if (occurrences.length === 0) continue;
    sortDenseMembershipOccurrences(occurrences);
    selections.set(partId, {
      nodeCount: candidate.nodeCount,
      occurrences,
    });
  }
  const cache = runtimeCache ?? new WeakMap<DenseNodeLayout, DenseNodeCacheEntry>();
  if (runtimeCache === undefined) selectionCache.set(runtime, cache);
  cache.set(layout, { selectedIds: data.selectedNodeIds, parts, selections });
  return selections;
}

/** Returns whether an occurrence has a dense-selected local node id. */
export function denseNodeSelectionContains(
  selection: DenseNodeSelection | undefined,
  slot: number,
  nodeId: number,
): boolean {
  if (!isValidNodeId(nodeId, selection?.nodeCount ?? 0)) return false;
  return denseMembershipContains(denseNodeOccurrenceAtSlot(selection, slot), nodeId);
}

export { denseNodeOccurrenceAtSlot };

/** Omits selected-only refs already represented by dense occurrence membership. */
export function sparseNodeEmphasisRefs(
  runtime: PackedSceneRuntime,
  layout: Pick<DenseNodeLayout, "slotPartLocal">,
  interaction: InteractionState,
  denseSelections: DenseNodeSelections,
): readonly NodeRef[] {
  const data = readInteractionState(interaction);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "node"
      ? { partOccurrenceId: data.hoveredTarget.partOccurrenceId, nodeId: data.hoveredTarget.nodeId }
      : undefined,
    (ref) => `${ref.partOccurrenceId}/${ref.nodeId}`,
    (push) => {
      appendNodeRefs(data.highlightedNodeIds, push);
      for (const [instanceId, ids] of sortedStringMapEntries(data.selectedNodeIds)) {
        if (instanceUsesDenseSelection(runtime, layout, denseSelections, instanceId)) continue;
        for (const nodeId of sortedNumbers(ids)) push({ partOccurrenceId: instanceId, nodeId });
      }
    },
  );
}

interface DenseNodeContext {
  readonly runtime: PackedSceneRuntime;
  readonly layout: DenseNodeLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly byPart: Map<PartId, DenseNodeBuilder>;
}

interface DenseNodeBuilder {
  readonly nodeCount: number;
  readonly slotCount: number;
  readonly candidates: DenseNodeCandidate[];
}

interface DenseNodeCandidate {
  readonly slot: number;
  readonly nodeIds: ReadonlySet<number>;
  readonly selectedCount: number;
}

function addInstanceSelection(
  context: DenseNodeContext,
  instanceId: PartOccurrenceId,
  nodeIds: ReadonlySet<number>,
): void {
  const { runtime, layout, parts, byPart } = context;
  const globalSlot = runtime.getInstanceSlot(instanceId);
  if (globalSlot === undefined) return;
  const partId = runtime.instancePartIds[globalSlot];
  const localSlot = layout.slotPartLocal[globalSlot];
  const part = partId === undefined ? undefined : parts.get(partId);
  if (partId === undefined || part === undefined || localSlot === undefined || localSlot < 0)
    return;
  const nodeCount = partNodeCount(part);
  const wordCount = Math.ceil(nodeCount / 32);
  const wordBytes = wordCount * Uint32Array.BYTES_PER_ELEMENT;
  const slotBytes = Uint32Array.BYTES_PER_ELEMENT;
  let validCount = 0;
  for (const nodeId of nodeIds) {
    if (isValidNodeId(nodeId, nodeCount)) validCount += 1;
  }
  // A single occurrence that cannot pay for its own bitset cannot become
  // dense after sharing the slot table with more occurrences: every other
  // candidate adds the same bitset bytes and at least four slot bytes.
  if (validCount === 0 || validCount * ELEMENT_RECORD_STRIDE <= wordBytes + slotBytes) {
    return;
  }
  let builder = byPart.get(partId);
  if (builder === undefined) {
    builder = {
      nodeCount,
      slotCount: layout.partLocalSlots.get(partId)?.length ?? 0,
      candidates: [],
    };
    byPart.set(partId, builder);
  }
  builder.candidates.push({ slot: localSlot, nodeIds, selectedCount: validCount });
}

function denseOccurrences(builder: DenseNodeBuilder): DenseNodeOccurrence[] {
  const wordCount = Math.ceil(builder.nodeCount / 32);
  const wordBytes = wordCount * Uint32Array.BYTES_PER_ELEMENT;
  let sparseBytes = 0;
  for (const candidate of builder.candidates) {
    sparseBytes += candidate.selectedCount * ELEMENT_RECORD_STRIDE;
  }
  const denseBytes =
    builder.slotCount * Uint32Array.BYTES_PER_ELEMENT + builder.candidates.length * wordBytes;
  if (sparseBytes <= denseBytes) return [];
  const occurrences: DenseNodeOccurrence[] = [];
  for (const candidate of builder.candidates) {
    const words = new Uint32Array(wordCount);
    for (const nodeId of candidate.nodeIds) {
      if (!isValidNodeId(nodeId, builder.nodeCount)) continue;
      const word = nodeId >> 5;
      words[word] = (words[word] ?? 0) | (1 << (nodeId & 31));
    }
    occurrences.push({
      slot: candidate.slot,
      selectedCount: candidate.selectedCount,
      words,
    });
  }
  return occurrences;
}

/** Returns whether one authored node id can address the part-local node data. */
export function isValidNodeId(nodeId: number, nodeCount: number): boolean {
  return Number.isSafeInteger(nodeId) && nodeId >= 0 && nodeId < nodeCount;
}

/** Returns whether a nested node selection contains at least one valid id. */
export function hasValidNodeSelection(
  nodeIds: ReadonlySet<number> | undefined,
  nodeCount: number,
): boolean {
  if (nodeIds === undefined) return false;
  for (const nodeId of nodeIds) {
    if (isValidNodeId(nodeId, nodeCount)) return true;
  }
  return false;
}

/** Returns the authored local node count without building the heavier semantic index. */
export function partNodeCount(part: Part): number {
  return Math.floor((part.nodePositions?.length ?? 0) / 3);
}

function instanceUsesDenseSelection(
  runtime: PackedSceneRuntime,
  layout: Pick<DenseNodeLayout, "slotPartLocal">,
  selections: DenseNodeSelections,
  instanceId: PartOccurrenceId,
): boolean {
  const globalSlot = runtime.getInstanceSlot(instanceId);
  if (globalSlot === undefined) return false;
  const partId = runtime.instancePartIds[globalSlot];
  const localSlot = layout.slotPartLocal[globalSlot];
  if (partId === undefined || localSlot === undefined || localSlot < 0) return false;
  return denseNodeOccurrenceAtSlot(selections.get(partId), localSlot) !== undefined;
}

function appendNodeRefs(
  groups: ReadonlyMap<PartOccurrenceId, ReadonlySet<number>>,
  push: (ref: NodeRef) => void,
): void {
  for (const [instanceId, ids] of sortedStringMapEntries(groups)) {
    for (const nodeId of sortedNumbers(ids)) push({ partOccurrenceId: instanceId, nodeId });
  }
}
