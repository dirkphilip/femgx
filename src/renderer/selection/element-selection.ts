import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import {
  collectUniqueRefs,
  sortedNumbers,
  sortedStringMapEntries,
} from "../../interaction/mechanics";
import {
  readInteractionState,
  readInteractionVisibility,
  type InteractionStateData,
} from "../../interaction/state";
import type { ElementRef, PartOccurrenceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import { ELEMENT_RECORD_STRIDE } from "./highlight-layout";
import {
  denseMembershipContains,
  denseMembershipOccurrenceAtSlot as denseOccurrenceAtSlot,
  sortDenseMembershipOccurrences,
  type DenseMembership,
  type DenseMembershipLayout,
  type DenseMembershipOccurrence,
} from "./dense-membership";

/** The stable layout fields required to resolve dense element selections. */
export type DenseElementLayout = DenseMembershipLayout;

/** One part-local occurrence's dense selected-element membership. */
export type DenseElementOccurrence = DenseMembershipOccurrence;

/** All dense element membership for one reusable part. */
export interface DenseElementSelection extends DenseMembership {
  readonly elementCount: number;
  readonly occurrences: readonly DenseElementOccurrence[];
}

/** Dense selected-element membership grouped by reusable part. */
export type DenseElementSelections = ReadonlyMap<PartId, DenseElementSelection>;

interface DenseElementCacheEntry {
  readonly elementIds: InteractionStateData["selectedElementIds"];
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly selections: DenseElementSelections;
}

const selectionCache = new WeakMap<
  PackedSceneRuntime,
  WeakMap<DenseElementLayout, DenseElementCacheEntry>
>();
const visibilityCache = new WeakMap<
  PackedSceneRuntime,
  WeakMap<DenseElementLayout, DenseElementCacheEntry>
>();

/** Drops cached membership after an in-place occurrence/layout mutation. */
export function invalidateDenseElementSelectionCaches(
  runtime: PackedSceneRuntime,
  layout: DenseElementLayout,
): void {
  selectionCache.get(runtime)?.delete(layout);
  visibilityCache.get(runtime)?.delete(layout);
}

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
  return collectDenseElementMemberships(
    runtime,
    layout,
    parts,
    data.selectedElementIds,
    selectionCache,
  );
}

/** Resolves broad hidden-element state to the same compact ordinal membership layout. */
export function collectDenseHiddenElements(
  runtime: PackedSceneRuntime,
  layout: DenseElementLayout,
  parts: ReadonlyMap<PartId, Part>,
  interaction: InteractionState,
): DenseElementSelections {
  return collectDenseElementMemberships(
    runtime,
    layout,
    parts,
    readInteractionVisibility(interaction).hiddenElementIds,
    visibilityCache,
  );
}

function collectDenseElementMemberships(
  runtime: PackedSceneRuntime,
  layout: DenseElementLayout,
  parts: ReadonlyMap<PartId, Part>,
  elementIdsByInstance: InteractionStateData["selectedElementIds"],
  cacheByRuntime: typeof selectionCache,
): DenseElementSelections {
  const runtimeCache = cacheByRuntime.get(runtime);
  const cached = runtimeCache?.get(layout);
  if (cached?.elementIds === elementIdsByInstance && cached.parts === parts) {
    return cached.selections;
  }
  const byPart = new Map<PartId, DenseSelectionBuilder>();
  for (const [instanceId, elementIds] of elementIdsByInstance) {
    addInstanceSelections({ runtime, layout, parts, byPart, instanceId, elementIds });
  }
  const selections = new Map<PartId, DenseElementSelection>();
  for (const [partId, candidate] of byPart) {
    const occurrences = denseOccurrences(candidate);
    if (occurrences.length === 0) continue;
    sortDenseMembershipOccurrences(occurrences);
    selections.set(partId, {
      elementCount: candidate.elementCount,
      occurrences,
    });
  }
  const cache = runtimeCache ?? new WeakMap<DenseElementLayout, DenseElementCacheEntry>();
  if (runtimeCache === undefined) cacheByRuntime.set(runtime, cache);
  cache.set(layout, { elementIds: elementIdsByInstance, parts, selections });
  return selections;
}

/** Returns whether an occurrence has a dense-selected ordinal. */
export function denseSelectionContains(
  selection: DenseElementSelection | undefined,
  slot: number,
  ordinal: number,
): boolean {
  return denseMembershipContains(denseOccurrenceAtSlot(selection, slot), ordinal - 1);
}

export { denseOccurrenceAtSlot };

/** Omits selected-only refs already represented by dense occurrence membership. */
export function sparseElementEmphasisRefs(
  runtime: PackedSceneRuntime,
  layout: Pick<DenseElementLayout, "slotPartLocal">,
  interaction: InteractionState,
  denseSelections: DenseElementSelections,
  denseHidden: DenseElementSelections = new Map(),
): readonly ElementRef[] {
  const data = readInteractionState(interaction);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "element"
      ? {
          partOccurrenceId: data.hoveredTarget.partOccurrenceId,
          elementId: data.hoveredTarget.elementId,
        }
      : undefined,
    (ref) => `${ref.partOccurrenceId}/${ref.elementId}`,
    (push) => {
      appendElementRefs(data.highlightedElementIds, push);
      for (const [instanceId, ids] of sortedStringMapEntries(data.selectedElementIds)) {
        if (instanceUsesDenseSelection(runtime, layout, denseSelections, instanceId)) continue;
        for (const elementId of sortedNumbers(ids))
          push({ partOccurrenceId: instanceId, elementId });
      }
      appendElementRefs(data.elementOverrides, push);
      for (const [instanceId, ids] of sortedStringMapEntries(
        readInteractionVisibility(interaction).hiddenElementIds,
      )) {
        if (instanceUsesDenseSelection(runtime, layout, denseHidden, instanceId)) continue;
        for (const elementId of sortedNumbers(ids))
          push({ partOccurrenceId: instanceId, elementId });
      }
    },
  );
}

function instanceUsesDenseSelection(
  runtime: PackedSceneRuntime,
  layout: Pick<DenseElementLayout, "slotPartLocal">,
  selections: DenseElementSelections,
  instanceId: PartOccurrenceId,
): boolean {
  const globalSlot = runtime.getInstanceSlot(instanceId);
  if (globalSlot === undefined) return false;
  const partId = runtime.instancePartIds[globalSlot];
  const localSlot = layout.slotPartLocal[globalSlot];
  if (partId === undefined || localSlot === undefined || localSlot < 0) return false;
  return denseOccurrenceAtSlot(selections.get(partId), localSlot) !== undefined;
}

function appendElementRefs(
  groups: ReadonlyMap<PartOccurrenceId, { readonly keys: () => Iterable<number> }>,
  push: (ref: ElementRef) => void,
): void {
  for (const [instanceId, values] of sortedStringMapEntries(groups)) {
    for (const elementId of sortedNumbers(values.keys()))
      push({ partOccurrenceId: instanceId, elementId });
  }
}

interface DenseSelectionContext {
  readonly runtime: PackedSceneRuntime;
  readonly layout: DenseElementLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly byPart: Map<PartId, DenseSelectionBuilder>;
  readonly instanceId: PartOccurrenceId;
  readonly elementIds: ReadonlySet<number>;
}

interface DenseSelectionBuilder {
  readonly elementCount: number;
  readonly slotCount: number;
  readonly candidates: DenseSelectionCandidate[];
}

interface DenseSelectionCandidate {
  readonly slot: number;
  readonly selectedCount: number;
  readonly words: Uint32Array;
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
  const wordBytes = Math.ceil(metadata.elementCount / 32) * Uint32Array.BYTES_PER_ELEMENT;
  if (elementIds.size * ELEMENT_RECORD_STRIDE <= wordBytes + 4) return;
  const words = new Uint32Array(wordBytes / Uint32Array.BYTES_PER_ELEMENT);
  let selectedCount = 0;
  for (const elementId of elementIds) {
    const ordinal = metadata.elementOrdinal(elementId);
    if (ordinal === undefined) continue;
    selectedCount += 1;
    const bit = ordinal - 1;
    words[bit >> 5] = (words[bit >> 5] ?? 0) | (1 << (bit & 31));
  }
  if (selectedCount === 0 || selectedCount * ELEMENT_RECORD_STRIDE <= wordBytes + 4) return;
  let builder = byPart.get(partId);
  if (builder === undefined) {
    builder = {
      elementCount: metadata.elementCount,
      slotCount: layout.partLocalSlots.get(partId)?.length ?? 0,
      candidates: [],
    };
    byPart.set(partId, builder);
  }
  builder.candidates.push({ slot: localSlot, selectedCount, words });
}

function denseOccurrences(builder: DenseSelectionBuilder): DenseElementOccurrence[] {
  const wordCount = Math.ceil(builder.elementCount / 32);
  let sparseBytes = 0;
  for (const candidate of builder.candidates) {
    sparseBytes += candidate.selectedCount * ELEMENT_RECORD_STRIDE;
  }
  const denseBytes =
    builder.slotCount * Uint32Array.BYTES_PER_ELEMENT +
    builder.candidates.length * wordCount * Uint32Array.BYTES_PER_ELEMENT;
  if (sparseBytes <= denseBytes) return [];
  return builder.candidates.map((candidate) => ({
    slot: candidate.slot,
    selectedCount: candidate.selectedCount,
    words: candidate.words,
  }));
}
