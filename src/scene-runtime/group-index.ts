import { invariantValue } from "./invariants";

/** Packed sorted keys and their contiguous list ranges. */
export interface KeyedGroupIndex {
  readonly sortedKeys: Uint32Array;
  readonly offsets: Uint32Array;
  readonly list: Uint32Array;
}

/** Resolves one packed key range while enforcing the group-array invariants. */
export function findGroupRange(
  sortedKeys: Uint32Array,
  offsets: Uint32Array,
  listLength: number,
  key: number,
): readonly [number, number] | undefined {
  if (offsets.length !== sortedKeys.length + 1) {
    throw new Error("Scene runtime invariant violated: group offsets are not terminated");
  }
  const position = lowerBound(sortedKeys, key);
  if (position === sortedKeys.length) return undefined;
  if (invariantValue(sortedKeys[position], `group key at ${position}`) !== key) {
    return undefined;
  }
  const start = invariantValue(offsets[position], `group start at ${position}`);
  const end = invariantValue(offsets[position + 1], `group end at ${position}`);
  if (start > end || end > listLength) {
    throw new Error(`Scene runtime invariant violated: invalid group range at ${position}`);
  }
  return [start, end];
}

function lowerBound(sortedKeys: Uint32Array, key: number): number {
  let low = 0;
  let high = sortedKeys.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    const value = invariantValue(sortedKeys[middle], `sorted group key at ${middle}`);
    if (value < key) low = middle + 1;
    else high = middle;
  }
  return low;
}
