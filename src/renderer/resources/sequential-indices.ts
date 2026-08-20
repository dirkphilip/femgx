/** Creates the dense corner index sequence shared by upload paths. */
export function sequentialIndices(count: number): Uint32Array {
  return Uint32Array.from({ length: count }, (_, index) => index);
}
