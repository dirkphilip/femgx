/** Returns a finite value unchanged and maps missing or non-finite values to zero. */
export function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

/** Returns the smallest power of two greater than or equal to the value. */
export function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}
