/** Private collision-resolving typed index for stable numeric identity pairs. */
export interface TypedPairIndex {
  readonly heads: Int32Array;
  readonly next: Int32Array;
}

/** Allocates one transient validation index without string or object keys. */
export function createTypedPairIndex(count: number): TypedPairIndex {
  let capacity = 1;
  while (capacity < Math.max(1, Math.ceil(count / 0.7))) capacity *= 2;
  return { heads: new Int32Array(capacity).fill(-1), next: new Int32Array(count).fill(-1) };
}

/** Adds a row's identity pair after it has passed its input-order validation. */
export function addTypedPair(
  index: TypedPairIndex,
  row: number,
  first: number,
  second: number,
): void {
  const slot = typedPairHash(first, second) & (index.heads.length - 1);
  index.next[row] = index.heads[slot] ?? -1;
  index.heads[slot] = row;
}

/** Resolves a prior or complete row by pair without a cardinality-scale JS map. */
export function findTypedPair(
  index: TypedPairIndex,
  values: readonly { readonly elementId: number; readonly faceIndex: number }[],
  first: number,
  second: number,
): number | undefined {
  for (
    let row = index.heads[typedPairHash(first, second) & (index.heads.length - 1)] ?? -1;
    row !== -1;
    row = index.next[row] ?? -1
  ) {
    const value = values[row];
    if (value?.elementId === first && value.faceIndex === second) return row;
  }
  return undefined;
}

function typedPairHash(first: number, second: number): number {
  return Math.imul(Math.imul(first >>> 0, 16_777_619) ^ (second >>> 0), 2_166_136_261) >>> 0;
}
