import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import { collectUniqueRefs, sortedNumbers } from "../../interaction/mechanics";
import { readInteractionState, type InteractionStateData } from "../../interaction/state";
import type { ElementRef, InstanceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import { ELEMENT_RECORD_STRIDE } from "./highlight-layout";

/** The stable layout fields required to resolve dense element selections. */
export interface DenseElementLayout {
  readonly slotPartLocal: Int32Array;
  readonly partSlots: ReadonlyMap<PartId, Uint32Array>;
  readonly partLocalSlots: ReadonlyMap<PartId, Int32Array>;
}

/** One part-local occurrence's dense selected-element membership. */
export interface DenseElementOccurrence {
  readonly slot: number;
  readonly selectedCount: number;
  /** One bit per private element ordinal (`ordinal - 1`). */
  readonly words: Uint32Array;
}

/** All dense element membership for one reusable part. */
export interface DenseElementSelection {
  readonly elementCount: number;
  readonly occurrences: readonly DenseElementOccurrence[];
}

/** Dense selected-element membership grouped by reusable part. */
export type DenseElementSelections = ReadonlyMap<PartId, DenseElementSelection>;

const selectionCache = new WeakMap<
  InteractionStateData["selectedElementIds"],
  readonly {
    readonly runtime: PackedSceneRuntime;
    readonly layout: DenseElementLayout;
    readonly parts: ReadonlyMap<PartId, Part>;
    readonly selections: DenseElementSelections;
  }[]
>();

/**
 * Resolves authored selected element ids to private part-local bitsets. The
 * returned occurrences are deterministic and contain no invalid or duplicate ids.
 */
export function collectDenseElementSelections(
  runtime: PackedSceneRuntime,
  layout: DenseElementLayout,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
): DenseElementSelections {
  const data = readInteractionState(interaction);
  const cached = selectionCache
    .get(data.selectedElementIds)
    ?.find(
      (entry) => entry.runtime === runtime && entry.layout === layout && entry.parts === parts,
    );
  if (cached !== undefined) {
    return cached.selections;
  }
  const byPart = new Map<PartId, DenseSelectionBuilder>();
  for (const [instanceId, elementIds] of data.selectedElementIds) {
    addInstanceSelections({ runtime, layout, parts, byPart, instanceId, elementIds });
  }
  const selections = new Map<PartId, DenseElementSelection>();
  for (const [partId, candidate] of byPart) {
    candidate.occurrences.sort((left, right) => left.slot - right.slot);
    const occurrences = candidate.occurrences;
    if (occurrences.length === 0) continue;
    selections.set(partId, {
      elementCount: candidate.elementCount,
      occurrences,
    });
  }
  const entries = selectionCache.get(data.selectedElementIds) ?? [];
  selectionCache.set(data.selectedElementIds, [...entries, { runtime, layout, parts, selections }]);
  return selections;
}

/** Returns whether an occurrence has a dense-selected ordinal. */
export function denseSelectionContains(
  selection: DenseElementSelection | undefined,
  slot: number,
  ordinal: number,
): boolean {
  const occurrence = denseOccurrenceAtSlot(selection, slot);
  if (occurrence === undefined) return false;
  const bit = ordinal - 1;
  return bit >= 0 && ((occurrence.words[bit >> 5] ?? 0) & (1 << (bit & 31))) !== 0;
}

/** Finds one sorted dense occurrence without scanning preceding placements. */
export function denseOccurrenceAtSlot(
  selection: DenseElementSelection | undefined,
  slot: number,
): DenseElementOccurrence | undefined {
  const occurrences = selection?.occurrences;
  if (occurrences === undefined) return undefined;
  let lower = 0;
  let upper = occurrences.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = occurrences[middle];
    if (candidate === undefined) return undefined;
    if (candidate.slot === slot) return candidate;
    if (candidate.slot < slot) lower = middle + 1;
    else upper = middle - 1;
  }
  return undefined;
}

/** Omits selected-only refs already represented by dense occurrence membership. */
export function sparseElementEmphasisRefs(
  runtime: PackedSceneRuntime,
  layout: Pick<DenseElementLayout, "slotPartLocal">,
  interaction: InteractionState,
  denseSelections: DenseElementSelections,
): readonly ElementRef[] {
  const data = readInteractionState(interaction);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "element"
      ? { instanceId: data.hoveredTarget.instanceId, elementId: data.hoveredTarget.elementId }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.elementId}`,
    (push) => {
      appendElementRefs(data.highlightedElementIds, push);
      for (const [instanceId, ids] of sortedInstances(data.selectedElementIds)) {
        if (instanceUsesDenseSelection(runtime, layout, denseSelections, instanceId)) continue;
        for (const elementId of sortedNumbers(ids)) push({ instanceId, elementId });
      }
      appendElementRefs(data.elementOverrides, push);
      appendElementRefs(data.hiddenElementIds, push);
    },
  );
}

function instanceUsesDenseSelection(
  runtime: PackedSceneRuntime,
  layout: Pick<DenseElementLayout, "slotPartLocal">,
  selections: DenseElementSelections,
  instanceId: InstanceId,
): boolean {
  const globalSlot = runtime.getInstanceSlot(instanceId);
  if (globalSlot === undefined) return false;
  const partId = runtime.instancePartIds[globalSlot];
  const localSlot = layout.slotPartLocal[globalSlot];
  if (partId === undefined || localSlot === undefined || localSlot < 0) return false;
  return denseOccurrenceAtSlot(selections.get(partId), localSlot) !== undefined;
}

function appendElementRefs(
  groups: ReadonlyMap<InstanceId, { readonly keys: () => Iterable<number> }>,
  push: (ref: ElementRef) => void,
): void {
  for (const [instanceId, values] of sortedInstances(groups)) {
    for (const elementId of sortedNumbers(values.keys())) push({ instanceId, elementId });
  }
}

function sortedInstances<Values>(
  groups: ReadonlyMap<InstanceId, Values>,
): Array<readonly [InstanceId, Values]> {
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

interface DenseSelectionContext {
  readonly runtime: PackedSceneRuntime;
  readonly layout: DenseElementLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly byPart: Map<PartId, DenseSelectionBuilder>;
  readonly instanceId: InstanceId;
  readonly elementIds: ReadonlySet<number>;
}

interface DenseSelectionBuilder {
  readonly elementCount: number;
  readonly occurrences: DenseElementOccurrence[];
}

function addInstanceSelections(context: DenseSelectionContext): void {
  const { runtime, layout, parts, byPart, instanceId, elementIds } = context;
  const globalSlot = runtime.getInstanceSlot(instanceId);
  if (globalSlot === undefined) return;
  const partId = runtime.instancePartIds[globalSlot];
  const localSlot = layout.slotPartLocal[globalSlot];
  const part = partId === undefined ? undefined : parts.get(partId);
  if (partId === undefined || part === undefined || localSlot === undefined || localSlot < 0) {
    return;
  }
  const metadata = getPartSemanticIndex(part);
  const wordCount = Math.ceil(metadata.elementOrdinalById.size / 32);
  const denseBytes = 4 + wordCount * Uint32Array.BYTES_PER_ELEMENT;
  if (elementIds.size * ELEMENT_RECORD_STRIDE <= denseBytes) return;
  const words = new Uint32Array(wordCount);
  let selectedCount = 0;
  for (const elementId of elementIds) {
    const ordinal = metadata.elementOrdinalById.get(elementId);
    if (ordinal === undefined) continue;
    const bit = ordinal - 1;
    const word = bit >> 5;
    const mask = 1 << (bit & 31);
    words[word] = (words[word] ?? 0) | mask;
    selectedCount += 1;
  }
  if (denseBytes >= selectedCount * ELEMENT_RECORD_STRIDE) return;
  let builder = byPart.get(partId);
  if (builder === undefined) {
    builder = { elementCount: metadata.elementOrdinalById.size, occurrences: [] };
    byPart.set(partId, builder);
  }
  builder.occurrences.push({ slot: localSlot, selectedCount, words });
}
