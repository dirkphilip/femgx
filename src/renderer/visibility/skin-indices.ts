const MAX_BOXED_INDEX_COUNT = 64 * 1024;

/** Chooses bounded one-pass growth only when the complete output stays small. */
export function buildVisibilityTriangleIndices(
  indexUpperBound: number,
  write: (target: Uint32Array | number[] | undefined) => number,
): Uint32Array {
  if (indexUpperBound <= MAX_BOXED_INDEX_COUNT) {
    const sparse: number[] = [];
    sparse.length = write(sparse);
    return Uint32Array.from(sparse);
  }
  const indexCount = write(undefined);
  if (indexCount === 0) return new Uint32Array(0);
  const result = new Uint32Array(indexCount);
  write(result);
  return result;
}

/** Writes consecutive expanded triangle indices and returns the next output offset. */
export function writeTriangleRange(
  target: Uint32Array | number[] | undefined,
  offset: number,
  primitiveStart: number,
  primitiveCount: number,
): number {
  const end = primitiveStart + primitiveCount;
  for (let primitive = primitiveStart; primitive < end; primitive += 1) {
    if (target !== undefined) {
      const base = primitive * 3;
      if (Array.isArray(target)) target.push(base, base + 1, base + 2);
      else {
        target[offset] = base;
        target[offset + 1] = base + 1;
        target[offset + 2] = base + 2;
      }
    }
    offset += 3;
  }
  return offset;
}
