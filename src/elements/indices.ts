/**
 * Bounds-checked read of an array element. The static topology tables and the
 * validated element connectivity guarantee that the indices used here are in
 * range, so a missing value signals an internal inconsistency rather than a
 * value that should silently propagate as `undefined`.
 */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Missing item at index ${index} of ${items.length}`);
  }
  return item;
}
