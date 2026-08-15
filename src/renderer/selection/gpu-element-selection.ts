import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import { readInteractionState } from "../../interaction/state";
import type { InstanceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { ELEMENT_RECORD_STRIDE } from "../resources/gpu-elements";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";

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
  return selections;
}

/** Returns whether an occurrence has a dense-selected ordinal. */
export function denseSelectionContains(
  selection: DenseElementSelection | undefined,
  slot: number,
  ordinal: number,
): boolean {
  const occurrence = selection?.occurrences.find((candidate) => candidate.slot === slot);
  return occurrence?.ordinals.includes(ordinal) === true;
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
  for (const elementId of elementIds) {
    const ordinal = metadata.elementOrdinalById.get(elementId);
    if (ordinal === undefined) continue;
    let ordinals = byPart.get(partId)?.get(localSlot);
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
