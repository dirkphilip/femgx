import type { Part, PartId } from "../../geometry/part";
import { readInteractionState, type InteractionState } from "../../interaction/state";
import type { PartOccurrenceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { hasValidNodeSelection, partNodeCount } from "./node-selection";

const MAX_SPARSE_SELECTION_OCCURRENCES = 1024;

interface SelectionCandidates {
  readonly slots: Set<number>;
  broad: boolean;
}

interface CandidateContext {
  readonly runtime: PackedSceneRuntime;
  readonly layout: SelectionOrderLayout;
  readonly requested: ReadonlySet<PartId>;
  readonly candidates: Map<PartId, SelectionCandidates>;
}

interface SelectionOrderLayout {
  readonly slotPartLocal: Int32Array;
  readonly partSlots: ReadonlyMap<PartId, Uint32Array>;
}

/** Returns whether a part's primary geometry is entirely authored point sprites. */
export function isPointOnlyPart(part: Part | undefined): boolean {
  return part?.geometries.every((geometry) => geometry.primitive === "points") ?? false;
}

/** Returns visible part-local slots carrying any selected target for each requested part. */
export function buildSelectionOrders(options: {
  readonly layout: SelectionOrderLayout;
  readonly runtime: PackedSceneRuntime;
  readonly partIds: Iterable<PartId>;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
}): ReadonlyMap<PartId, Uint32Array> {
  const requested = new Set(options.partIds);
  const data = readInteractionState(options.interaction);
  const candidates = new Map<PartId, SelectionCandidates>();
  for (const partId of data.selectedPartIds) {
    if (requested.has(partId)) candidate(candidates, partId).broad = true;
  }
  const solePart = soleRuntimePart(options.runtime, options.layout, requested);
  if (
    solePart !== undefined &&
    selectedOccurrenceEntryCount(data) > MAX_SPARSE_SELECTION_OCCURRENCES
  )
    candidate(candidates, solePart).broad = true;
  if (solePart === undefined || candidates.get(solePart)?.broad !== true) {
    collectCandidates(
      { runtime: options.runtime, layout: options.layout, requested, candidates },
      data,
      options.parts,
    );
  }
  const orders = new Map<PartId, Uint32Array>();
  for (const partId of requested) {
    const selected = candidates.get(partId);
    orders.set(
      partId,
      selected?.broad === true
        ? broadSelectionOrder(
            options.layout,
            options.runtime,
            partId,
            data,
            options.parts.get(partId),
          )
        : sparseSelectionOrder(options.layout, selected?.slots),
    );
  }
  return orders;
}

/** Returns visible part-local slots carrying any selected target for one part. */
export function buildSelectionOrder(
  layout: SelectionOrderLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
  interaction: InteractionState,
  parts: ReadonlyMap<PartId, Part>,
): Uint32Array {
  return (
    buildSelectionOrders({ layout, runtime, partIds: [partId], interaction, parts }).get(partId) ??
    new Uint32Array()
  );
}

function collectCandidates(
  context: CandidateContext,
  data: ReturnType<typeof readInteractionState>,
  parts: ReadonlyMap<PartId, Part>,
): void {
  addIds(context, data.selectedPartOccurrenceIds);
  addGroupIds(context, data.selectedBodyIds);
  addGroupIds(context, data.selectedElementIds);
  addGroupIds(context, data.selectedFaces);
  for (const [instanceId, nodeIds] of data.selectedNodeIds) {
    const slot = context.runtime.getInstanceSlot(instanceId);
    const partId = slot === undefined ? undefined : context.runtime.instancePartIds[slot];
    const part = partId === undefined ? undefined : parts.get(partId);
    if (
      isPointOnlyPart(part) &&
      hasValidNodeSelection(nodeIds, part === undefined ? 0 : partNodeCount(part))
    ) {
      addCandidate(context, instanceId);
    }
  }
}

function addIds(context: CandidateContext, ids: Iterable<PartOccurrenceId>): void {
  for (const instanceId of ids) addCandidate(context, instanceId);
}

function addGroupIds(
  context: CandidateContext,
  groups: ReadonlyMap<PartOccurrenceId, { readonly size: number }>,
): void {
  for (const [instanceId, values] of groups) {
    if (values.size > 0) addCandidate(context, instanceId);
  }
}

function addCandidate(context: CandidateContext, instanceId: PartOccurrenceId): void {
  const slot = context.runtime.getInstanceSlot(instanceId);
  if (slot === undefined || !context.runtime.isInstanceVisible(slot)) return;
  const partId = context.runtime.instancePartIds[slot];
  if (partId === undefined || !context.requested.has(partId)) return;
  const selected = candidate(context.candidates, partId);
  if (selected.broad) return;
  selected.slots.add(slot);
  if (selected.slots.size > MAX_SPARSE_SELECTION_OCCURRENCES) {
    selected.slots.clear();
    selected.broad = true;
  }
}

function candidate(
  candidates: Map<PartId, SelectionCandidates>,
  partId: PartId,
): SelectionCandidates {
  let selected = candidates.get(partId);
  if (selected === undefined) {
    selected = { slots: new Set(), broad: false };
    candidates.set(partId, selected);
  }
  return selected;
}

function sparseSelectionOrder(
  layout: SelectionOrderLayout,
  slots: ReadonlySet<number> | undefined,
): Uint32Array {
  if (slots === undefined || slots.size === 0) return new Uint32Array();
  const sorted = [...slots].sort((left, right) => left - right);
  return Uint32Array.from(sorted, (slot) => layout.slotPartLocal[slot] ?? -1);
}

function broadSelectionOrder(
  layout: SelectionOrderLayout,
  runtime: PackedSceneRuntime,
  partId: PartId,
  data: ReturnType<typeof readInteractionState>,
  part: Part | undefined,
): Uint32Array {
  const order: number[] = [];
  for (const slot of layout.partSlots.get(partId) ?? []) {
    const instanceId = runtime.getInstanceId(slot);
    const local = layout.slotPartLocal[slot];
    if (
      instanceId !== undefined &&
      local !== undefined &&
      local >= 0 &&
      runtime.isInstanceVisible(slot) &&
      hasSelectedTarget(data, instanceId, partId, part)
    ) {
      order.push(local);
    }
  }
  return new Uint32Array(order);
}

function hasSelectedTarget(
  data: ReturnType<typeof readInteractionState>,
  instanceId: PartOccurrenceId,
  partId: PartId,
  part: Part | undefined,
): boolean {
  return (
    data.selectedPartIds.has(partId) ||
    data.selectedPartOccurrenceIds.has(instanceId) ||
    (data.selectedBodyIds.get(instanceId)?.size ?? 0) > 0 ||
    (data.selectedElementIds.get(instanceId)?.size ?? 0) > 0 ||
    (data.selectedFaces.get(instanceId)?.size ?? 0) > 0 ||
    (isPointOnlyPart(part) &&
      hasValidNodeSelection(
        data.selectedNodeIds.get(instanceId),
        part === undefined ? 0 : partNodeCount(part),
      ))
  );
}

function soleRuntimePart(
  runtime: PackedSceneRuntime,
  layout: SelectionOrderLayout,
  requested: ReadonlySet<PartId>,
): PartId | undefined {
  if (requested.size !== 1) return undefined;
  const partId = requested.values().next().value;
  return partId !== undefined && layout.partSlots.get(partId)?.length === runtime.instanceCount
    ? partId
    : undefined;
}

function selectedOccurrenceEntryCount(data: ReturnType<typeof readInteractionState>): number {
  return (
    data.selectedPartOccurrenceIds.size +
    data.selectedBodyIds.size +
    data.selectedElementIds.size +
    data.selectedFaces.size +
    data.selectedNodeIds.size
  );
}
