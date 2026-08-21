import type { Part, PartId } from "../../../geometry/part";
import type { ResultColorMap } from "../../../results/colors";
import { PartRevisionMap } from "../../attachment/part-revision-overlay";
import type { SectionCapFrame } from "../../section-caps";
import { removeSectionCapCalls } from "./section-cap-calls";
import { sectionCapKey } from "./section-cap-ids";

/** Removes exact cap-owned entries without copying retained frame collections. */
export function removeSectionCaps(
  frame: SectionCapFrame,
  capIds: ReadonlySet<PartId>,
): SectionCapFrame {
  return {
    parts: removedEntries(frame.parts, capIds),
    sourcePartIds: removedEntries(frame.sourcePartIds, capIds),
    sourceCapIds: retainedSourceCapIds(frame.sourceCapIds, frame.sourcePartIds, capIds),
    sourceSlots: removedEntries(frame.sourceSlots, capIds),
    capIdsBySourceSlot: retainedSlotCapIds(frame, capIds),
    capIdsByKey: retainedCapKeys(frame, capIds),
    calls: removeSectionCapCalls(frame.calls, capIds),
    transparentCalls: removeSectionCapCalls(frame.transparentCalls, capIds),
    allCalls: removeSectionCapCalls(frame.allCalls, capIds),
    resultColors: removedEntries(frame.resultColors, capIds),
    nextCapId: frame.nextCapId,
  };
}

function retainedSlotCapIds(
  frame: SectionCapFrame,
  capIds: ReadonlySet<PartId>,
): ReadonlyMap<number, Set<PartId>> {
  const retained = new PartRevisionMap(frame.capIdsBySourceSlot);
  const slots = new Set<number>();
  for (const capId of capIds) {
    const slot = frame.sourceSlots.get(capId);
    if (slot !== undefined) slots.add(slot);
  }
  for (const slot of slots) {
    const next = new Set(frame.capIdsBySourceSlot.get(slot));
    for (const capId of capIds) next.delete(capId);
    if (next.size === 0) retained.delete(slot);
    else retained.set(slot, next);
  }
  return retained;
}

function retainedCapKeys(
  frame: SectionCapFrame,
  capIds: ReadonlySet<PartId>,
): ReadonlyMap<string, PartId> {
  const retained = new PartRevisionMap(frame.capIdsByKey);
  for (const capId of capIds) {
    const sourcePartId = frame.sourcePartIds.get(capId);
    const slot = frame.sourceSlots.get(capId);
    const elementId = frame.parts.get(capId)?.elements?.at(0)?.id;
    if (sourcePartId !== undefined && slot !== undefined && elementId !== undefined)
      retained.delete(sectionCapKey(sourcePartId, slot, elementId));
  }
  return retained;
}

/** Combines repeated revision requests without iterating retained source state. */
export function mergeRevisedPartIds(
  previous: ReadonlySet<PartId> | undefined,
  added: ReadonlySet<PartId>,
): ReadonlySet<PartId> {
  return previous === undefined ? new Set(added) : new Set([...previous, ...added]);
}

/** Updates only the changed source and cap entries in rendered-part ownership. */
export function reviseSectionCapParts(
  previous: ReadonlyMap<PartId, Part>,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  capIds: ReadonlySet<PartId>,
): ReadonlyMap<PartId, Part> {
  const next = new PartRevisionMap(previous);
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) next.delete(partId);
    else next.set(partId, part);
  }
  for (const capId of capIds) next.delete(capId);
  return next;
}

/** Adds only newly rebuilt cap entries to the already revised rendered-part map. */
export function appendRevisedSectionCapParts(
  previous: ReadonlyMap<PartId, Part>,
  frame: SectionCapFrame,
  partIds: ReadonlySet<PartId>,
): ReadonlyMap<PartId, Part> {
  const next = new PartRevisionMap(previous);
  for (const partId of partIds) {
    for (const capId of frame.sourceCapIds.get(partId) ?? []) {
      const cap = frame.parts.get(capId);
      if (cap !== undefined) next.set(capId, cap);
    }
  }
  return next;
}

/** Removes only stale source/cap result table entries. */
export function reviseSectionCapColors(
  previous: ResultColorMap | undefined,
  partIds: ReadonlySet<PartId>,
  capIds: ReadonlySet<PartId>,
): ResultColorMap | undefined {
  if (previous === undefined) return undefined;
  const next = new PartRevisionMap(previous);
  for (const partId of partIds) next.delete(partId);
  for (const capId of capIds) next.delete(capId);
  return next;
}

/** Installs changed source and cap result colors after an exact cap rebuild. */
export function reconcileRevisedSectionCapColors(
  previous: ResultColorMap | undefined,
  source: ResultColorMap | undefined,
  frame: SectionCapFrame,
  partIds: ReadonlySet<PartId>,
): ResultColorMap | undefined {
  if (previous === undefined && source === undefined) return undefined;
  const next = new PartRevisionMap(previous ?? source ?? new Map());
  for (const partId of partIds) {
    const sourceColor = source?.get(partId);
    if (sourceColor === undefined) next.delete(partId);
    else next.set(partId, sourceColor);
    for (const capId of frame.sourceCapIds.get(partId) ?? []) {
      const capColor = frame.resultColors.get(capId);
      if (capColor === undefined) next.delete(capId);
      else next.set(capId, capColor);
    }
  }
  return next;
}

function retainedSourceCapIds(
  sourceCapIds: ReadonlyMap<PartId, Set<PartId>>,
  sourcePartIds: ReadonlyMap<PartId, PartId>,
  capIds: ReadonlySet<PartId>,
): ReadonlyMap<PartId, Set<PartId>> {
  const retained = new PartRevisionMap(sourceCapIds);
  const affected = new Set<PartId>();
  for (const capId of capIds) {
    const sourcePartId = sourcePartIds.get(capId);
    if (sourcePartId !== undefined) affected.add(sourcePartId);
  }
  for (const partId of affected) {
    const source = sourceCapIds.get(partId);
    if (source === undefined) continue;
    const next = new Set(source);
    for (const capId of capIds) next.delete(capId);
    if (next.size > 0) retained.set(partId, next);
    else retained.delete(partId);
  }
  return retained;
}

function removedEntries<K, V>(
  values: ReadonlyMap<K, V>,
  removed: ReadonlySet<K>,
): ReadonlyMap<K, V> {
  const retained = new PartRevisionMap(values);
  for (const key of removed) retained.delete(key);
  return retained;
}
