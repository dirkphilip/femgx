import type { PartId } from "../geometry/part";
import { invariantValue } from "./invariants";

/** Adds one part id while retaining ascending runtime draw membership. */
export function insertSortedPartId(values: Uint32Array, id: PartId): Uint32Array {
  const next = new Uint32Array(values.length + 1);
  let index = 0;
  while (index < values.length && (values[index] ?? 0) < id) index += 1;
  next.set(values.subarray(0, index));
  next[index] = id;
  next.set(values.subarray(index), index + 1);
  return next;
}

/** Removes one part id while retaining ascending runtime draw membership. */
export function removeSortedPartId(values: Uint32Array, id: PartId): Uint32Array {
  const index = values.indexOf(id);
  if (index < 0) return values;
  const next = new Uint32Array(values.length - 1);
  next.set(values.subarray(0, index));
  next.set(values.subarray(index + 1), index);
  return next;
}

/** Merges one transaction's distinct additions into ascending runtime membership. */
export function mergeSortedPartIds(values: Uint32Array, added: ReadonlySet<PartId>): Uint32Array {
  const additions = Uint32Array.from(added).sort();
  const next = new Uint32Array(values.length + additions.length);
  let left = 0;
  let right = 0;
  let target = 0;
  while (left < values.length && right < additions.length) {
    const previous = invariantValue(values[left], `sorted part id at ${left}`);
    const addition = invariantValue(additions[right], `added part id at ${right}`);
    if (previous < addition) {
      next[target++] = previous;
      left += 1;
    } else {
      next[target++] = addition;
      right += 1;
    }
  }
  next.set(values.subarray(left), target);
  next.set(additions.subarray(right), target + values.length - left);
  return next;
}

/** Removes one transaction's distinct ids from ascending runtime membership. */
export function removeSortedPartIds(
  values: Uint32Array,
  removed: ReadonlySet<PartId>,
): Uint32Array {
  const next = new Uint32Array(values.length - removed.size);
  let target = 0;
  for (const value of values) if (!removed.has(value)) next[target++] = value;
  if (target !== next.length)
    throw new Error("Removed part ids are missing from sorted membership");
  return next;
}
