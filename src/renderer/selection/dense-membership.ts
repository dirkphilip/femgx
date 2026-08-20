import type { PartId } from "../../geometry/part";

/** The stable layout fields required to resolve dense occurrence membership. */
export interface DenseMembershipLayout {
  readonly slotPartLocal: Int32Array;
  readonly partSlots: ReadonlyMap<PartId, Uint32Array>;
  readonly partLocalSlots: ReadonlyMap<PartId, Int32Array>;
}

/** One part-local occurrence's dense membership bits. */
export interface DenseMembershipOccurrence {
  readonly slot: number;
  readonly selectedCount: number;
  readonly words: Uint32Array;
}

/** All dense membership for one reusable part. */
export interface DenseMembership {
  readonly occurrences: readonly DenseMembershipOccurrence[];
}

/** Orders owned occurrence records by their stable part-local slot. */
export function sortDenseMembershipOccurrences<Occurrence extends DenseMembershipOccurrence>(
  occurrences: Occurrence[],
): Occurrence[] {
  return occurrences.sort((left, right) => left.slot - right.slot);
}

/** Finds one sorted dense occurrence without scanning preceding placements. */
export function denseMembershipOccurrenceAtSlot<Occurrence extends DenseMembershipOccurrence>(
  membership: { readonly occurrences: readonly Occurrence[] } | undefined,
  slot: number,
): Occurrence | undefined {
  if (!Number.isSafeInteger(slot) || slot < 0) return undefined;
  const occurrences = membership?.occurrences;
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

/** Returns whether one zero-based member index is present for an occurrence. */
export function denseMembershipContains(
  occurrence: DenseMembershipOccurrence | undefined,
  memberIndex: number,
): boolean {
  if (occurrence === undefined || !Number.isSafeInteger(memberIndex) || memberIndex < 0)
    return false;
  const word = Math.floor(memberIndex / 32);
  return ((occurrence.words[word] ?? 0) & (1 << (memberIndex % 32))) !== 0;
}
