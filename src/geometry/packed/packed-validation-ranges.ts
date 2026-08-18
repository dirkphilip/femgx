/** Validates one non-empty half-open primitive range. */
export function validatePackedRange(
  label: string,
  start: number,
  size: number,
  count: number,
): void {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(size) ||
    start < 0 ||
    size <= 0 ||
    start + size > count
  ) {
    throw new Error(`${label} has an invalid primitive range`);
  }
}

/** Marks an owned primitive range and rejects overlap. */
export function markPackedCoverage(
  coverage: Uint8Array,
  start: number,
  size: number,
  label: string,
): void {
  for (let index = start; index < start + size; index += 1) {
    if (coverage[index] === 1) throw new Error(`${label} belongs to more than one owner`);
    coverage[index] = 1;
  }
}

/** Requires every primitive in a validated buffer to have an owner. */
export function requirePackedCoverage(coverage: Uint8Array, label: string): void {
  for (let index = 0; index < coverage.length; index += 1) {
    if (coverage[index] === 0) throw new Error(`${label} ${index} is not covered`);
  }
}
