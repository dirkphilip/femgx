import type { ElementId } from "../elements/element";
import type { PartOccurrenceId } from "../scene/types";

/**
 * Exact occurrence-grouped element identities returned by an element region query.
 *
 * Groups and ids are sorted deterministically. The typed columns contain authored
 * identities only: neither runtime slots nor GPU pick ids are exposed.
 * @category Interaction and picking
 */
export interface ElementRegionSelection {
  /** Fixed packed-region discriminator. */
  readonly kind: "element";
  /** Number of selected element identities. */
  readonly count: number;
  /** Stable occurrence identities, one for every CSR group. */
  readonly partOccurrenceIds: readonly PartOccurrenceId[];
  /** CSR offsets into {@link elementIds}; starts at zero and ends at `count`. */
  readonly offsets: Uint32Array;
  /** Sorted, duplicate-free authored element ids grouped by occurrence. */
  readonly elementIds: Uint32Array;
}

/** Creates a validated, deterministically ordered packed element selection. */
export function createElementRegionSelection(
  groups: ReadonlyMap<PartOccurrenceId, Iterable<ElementId>>,
): ElementRegionSelection {
  const ordered = [...groups.entries()]
    .map(([partOccurrenceId, values]) => ({
      partOccurrenceId,
      elementIds: uniqueSortedElementIds(values),
    }))
    .filter(({ elementIds }) => elementIds.length > 0)
    .sort((left, right) => compareOccurrenceIds(left.partOccurrenceId, right.partOccurrenceId));
  const count = ordered.reduce((total, group) => total + group.elementIds.length, 0);
  assertUint32Count(count);
  const partOccurrenceIds = new Array<PartOccurrenceId>(ordered.length);
  const offsets = new Uint32Array(ordered.length + 1);
  const elementIds = new Uint32Array(count);
  let cursor = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const group = ordered[index];
    if (group === undefined) continue;
    partOccurrenceIds[index] = group.partOccurrenceId;
    offsets[index] = cursor;
    elementIds.set(group.elementIds, cursor);
    cursor += group.elementIds.length;
  }
  offsets[ordered.length] = cursor;
  return { kind: "element", count, partOccurrenceIds, offsets, elementIds };
}

/** Verifies a caller-provided packed selection before it becomes interaction state. */
export function assertElementRegionSelection(
  selection: ElementRegionSelection,
): asserts selection is ElementRegionSelection {
  if (!Number.isSafeInteger(selection.count) || selection.count < 0) {
    throw new TypeError("Element region selection count must be a non-negative safe integer");
  }
  if (selection.count !== selection.elementIds.length || selection.offsets.length === 0) {
    throw new TypeError("Element region selection columns have inconsistent lengths");
  }
  if (
    selection.offsets.length !== selection.partOccurrenceIds.length + 1 ||
    selection.offsets[0] !== 0
  ) {
    throw new TypeError(
      "Element region selection offsets must match occurrence groups and start at zero",
    );
  }
  let previousOccurrence: PartOccurrenceId | undefined;
  for (let group = 0; group < selection.partOccurrenceIds.length; group += 1) {
    const occurrenceId = selection.partOccurrenceIds[group];
    const start = selection.offsets[group];
    const end = selection.offsets[group + 1];
    if (
      occurrenceId === undefined ||
      occurrenceId.length === 0 ||
      start === undefined ||
      end === undefined ||
      start >= end ||
      end > selection.elementIds.length ||
      (previousOccurrence !== undefined &&
        compareOccurrenceIds(previousOccurrence, occurrenceId) >= 0)
    ) {
      throw new TypeError(
        "Element region selection groups must be non-empty and deterministically ordered",
      );
    }
    previousOccurrence = occurrenceId;
    let previousId = -1;
    for (let index = start; index < end; index += 1) {
      const elementId = selection.elementIds[index];
      if (elementId === undefined || elementId <= previousId) {
        throw new TypeError("Element region selection ids must be sorted and duplicate-free");
      }
      previousId = elementId;
    }
  }
  if (selection.offsets.at(-1) !== selection.elementIds.length) {
    throw new TypeError("Element region selection final offset must equal element id count");
  }
}

/** Returns caller-owned typed columns so mutation cannot affect an immutable state snapshot. */
export function copyElementRegionSelection(
  selection: ElementRegionSelection,
): ElementRegionSelection {
  return {
    kind: "element",
    count: selection.count,
    partOccurrenceIds: [...selection.partOccurrenceIds],
    offsets: selection.offsets.slice(),
    elementIds: selection.elementIds.slice(),
  };
}

function uniqueSortedElementIds(values: Iterable<ElementId>): Uint32Array {
  if (values instanceof Set) return sortedSetElementIds(values);
  const ids = new Set<number>();
  for (const value of values) {
    ids.add(unsignedElementId(value));
  }
  return Uint32Array.from(ids).sort();
}

function sortedSetElementIds(values: ReadonlySet<ElementId>): Uint32Array {
  const ids = new Uint32Array(values.size);
  let index = 0;
  for (const value of values) ids[index++] = unsignedElementId(value);
  return ids.sort();
}

function unsignedElementId(value: ElementId): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new TypeError("Element region selection ids must be unsigned 32-bit integers");
  }
  return value;
}

function assertUint32Count(count: number): void {
  if (count > 0xffff_ffff) throw new RangeError("Element region selection exceeds Uint32 capacity");
}

function compareOccurrenceIds(left: PartOccurrenceId, right: PartOccurrenceId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
