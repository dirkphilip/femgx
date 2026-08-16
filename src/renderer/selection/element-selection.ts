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
}

/** One part-local occurrence's dense selected-element membership. */
export interface DenseElementOccurrence {
  readonly slot: number;
  readonly ordinals: readonly number[];
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
 * Resolves authored selected element ids to private part-local ordinals. The
 * returned lists are deterministic and contain no invalid or duplicate ids.
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
  const byPart = new Map<PartId, Map<number, Set<number>>>();
  for (const [instanceId, elementIds] of data.selectedElementIds) {
    addInstanceSelections({ runtime, layout, parts, byPart, instanceId, elementIds });
  }
  const selections = new Map<PartId, DenseElementSelection>();
  for (const [partId, bySlot] of byPart) {
    const part = parts.get(partId);
    if (part === undefined) continue;
    const metadata = getPartSemanticIndex(part);
    const occurrences = [...bySlot.entries()]
      .sort(([left], [right]) => left - right)
      .map(([slot, ordinals]) => ({ slot, ordinals: [...ordinals].sort((a, b) => a - b) }))
      .filter(({ ordinals }) => {
        const denseBytes = 4 + Math.ceil(metadata.elementOrdinalById.size / 32) * 4;
        return denseBytes < ordinals.length * ELEMENT_RECORD_STRIDE;
      });
    if (occurrences.length === 0) continue;
    selections.set(partId, {
      elementCount: metadata.elementOrdinalById.size,
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
  const occurrence = selection?.occurrences.find((candidate) => candidate.slot === slot);
  if (occurrence === undefined) return false;
  let low = 0;
  let high = occurrence.ordinals.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = occurrence.ordinals[middle];
    if (candidate === ordinal) return true;
    if (candidate === undefined || candidate > ordinal) high = middle - 1;
    else low = middle + 1;
  }
  return false;
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
  return selections.get(partId)?.occurrences.some(({ slot }) => slot === localSlot) === true;
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
  readonly byPart: Map<PartId, Map<number, Set<number>>>;
  readonly instanceId: InstanceId;
  readonly elementIds: ReadonlySet<number>;
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
  let ordinals = byPart.get(partId)?.get(localSlot);
  for (const elementId of elementIds) {
    const ordinal = metadata.elementOrdinalById.get(elementId);
    if (ordinal === undefined) continue;
    if (ordinals === undefined) {
      ordinals = new Set();
      let bySlot = byPart.get(partId);
      if (bySlot === undefined) {
        bySlot = new Map();
        byPart.set(partId, bySlot);
      }
      bySlot.set(localSlot, ordinals);
    }
    ordinals.add(ordinal);
  }
}
