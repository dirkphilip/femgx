/** Maximum number of records probed for one emphasis lookup in WGSL. */
export const HIGHLIGHT_BUCKET_SIZE = 4;

/** Distinguishes body records from element records in the shared table key. */
export const BODY_HIGHLIGHT_MARKER = 0xffffffff;
/** Distinguishes semantic block records from element records. */
export const BLOCK_HIGHLIGHT_MARKER = 0xfffffffe;

/** One CPU-side emphasis record ready for placement in the GPU table. */
export interface HighlightTableEntry {
  readonly slot: number;
  readonly elementPickId: number;
  readonly facePickId: number;
  readonly nodePickId: number;
  readonly data: ArrayBuffer;
}

/** A bounded-bucket table consumed by the visible vertex shaders. */
export interface HighlightTable {
  readonly bucketCount: number;
  readonly seed: number;
  readonly entries: ReadonlyArray<HighlightTableEntry | undefined>;
}

/**
 * Builds a deterministic bounded-bucket table. A lookup reads one bucket and
 * therefore stays constant-time even when many elements are emphasized. The
 * bucket count grows until every record fits, independently of GPU capacity.
 */
export function buildHighlightTable(entries: readonly HighlightTableEntry[]): HighlightTable {
  if (entries.length === 0) return { bucketCount: 0, seed: 0, entries: [] };
  const ordered = [...entries].sort(compareEntries);
  let bucketCount = nextPowerOfTwo(Math.max(1, Math.ceil(entries.length / 2)));
  const maximumBucketCount = nextPowerOfTwo(entries.length) * HIGHLIGHT_BUCKET_SIZE;
  while (bucketCount <= maximumBucketCount) {
    for (let seed = 0; seed < 256; seed += 1) {
      const table = placeEntries(ordered, bucketCount, seed);
      if (table !== undefined) return table;
    }
    bucketCount *= 2;
  }
  throw new Error(`Cannot build bounded highlight table for ${entries.length} records`);
}

/** Returns the same u32 hash used by the WGSL emphasis lookup. */
export function highlightHash(
  slot: number,
  elementPickId: number,
  facePickId: number,
  nodePickId: number,
  seed: number,
): number {
  let hash = seed >>> 0;
  hash ^= Math.imul(slot >>> 0, 0x9e3779b9);
  hash ^= Math.imul(elementPickId >>> 0, 0x85ebca6b);
  hash ^= Math.imul(facePickId >>> 0, 0xc2b2ae35);
  hash ^= Math.imul(nodePickId >>> 0, 0x27d4eb2f);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function placeEntries(
  entries: readonly HighlightTableEntry[],
  bucketCount: number,
  seed: number,
): HighlightTable | undefined {
  const table: Array<HighlightTableEntry | undefined> = new Array<HighlightTableEntry | undefined>(
    bucketCount * HIGHLIGHT_BUCKET_SIZE,
  );
  const used = new Uint8Array(bucketCount);
  for (const entry of entries) {
    const bucket =
      highlightHash(entry.slot, entry.elementPickId, entry.facePickId, entry.nodePickId, seed) &
      (bucketCount - 1);
    const offset = bucket * HIGHLIGHT_BUCKET_SIZE + (used[bucket] ?? 0);
    if ((used[bucket] ?? 0) >= HIGHLIGHT_BUCKET_SIZE) return undefined;
    table[offset] = entry;
    used[bucket] = (used[bucket] ?? 0) + 1;
  }
  return { bucketCount, seed, entries: table };
}

function compareEntries(left: HighlightTableEntry, right: HighlightTableEntry): number {
  return (
    left.slot - right.slot ||
    left.elementPickId - right.elementPickId ||
    left.facePickId - right.facePickId ||
    left.nodePickId - right.nodePickId
  );
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}
