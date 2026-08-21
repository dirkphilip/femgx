import type { Part, PartId } from "../../../geometry/part";
import type { ResultColorMap } from "../../../results/colors";
import type { DrawCall } from "../draw-resources";
import { PartRevisionMap } from "../../attachment/part-revision-overlay";
import type { SectionCapFrame } from "../../section-caps";

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
    calls: removedCalls(frame.calls, capIds),
    transparentCalls: removedCalls(frame.transparentCalls, capIds),
    allCalls: removedCalls(frame.allCalls, capIds),
    resultColors: removedEntries(frame.resultColors, capIds),
    nextCapId: frame.nextCapId,
  };
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

function removedCalls(calls: readonly DrawCall[], removed: ReadonlySet<PartId>): DrawCall[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- frame encoding consumes only length and iteration.
  return new RemovedSectionCapCalls(calls, removed) as unknown as DrawCall[];
}

class RemovedSectionCapCalls implements Iterable<DrawCall> {
  private count: number | undefined;

  public constructor(
    private readonly source: readonly DrawCall[],
    private readonly removed: ReadonlySet<PartId>,
  ) {}

  public get length(): number {
    this.count ??= this.measure();
    return this.count;
  }

  public *[Symbol.iterator](): Iterator<DrawCall> {
    for (const call of this.source) if (!this.removed.has(call.partId)) yield call;
  }

  private measure(): number {
    let count = 0;
    for (const _call of this) count += 1;
    return count;
  }
}
