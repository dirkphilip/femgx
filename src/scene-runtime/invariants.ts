/** Reads a value that must exist after scene compilation has validated packing. */
export function invariantValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Scene runtime invariant violated: ${label}`);
  }
  return value;
}
