import { sortIndexRows } from "../math/index-merge-sort";

const RADIX_SIZE = 1 << 16;
const RADIX_MASK = RADIX_SIZE - 1;

/** Orders fixed-width canonical Uint32 rows exactly with bounded dense storage. */
export function sortFixedCanonicalRows(nodes: Uint32Array, width: number): Uint32Array {
  if (!Number.isInteger(width) || width < 1 || nodes.length % width !== 0) {
    throw new Error("Canonical row width does not divide the node table");
  }
  const rowCount = nodes.length / width;
  const order = new Uint32Array(rowCount);
  const scratch = new Uint32Array(rowCount);
  const counts = new Uint32Array(RADIX_SIZE);
  for (let row = 0; row < rowCount; row += 1) order[row] = row;
  let source = order;
  let target = scratch;
  for (let column = width - 1; column >= 0; column -= 1) {
    radixPass({ nodes, width, column, shift: 0 }, source, target, counts);
    [source, target] = [target, source];
    radixPass({ nodes, width, column, shift: 16 }, source, target, counts);
    [source, target] = [target, source];
  }
  return source;
}

function radixPass(
  input: {
    readonly nodes: Uint32Array;
    readonly width: number;
    readonly column: number;
    readonly shift: number;
  },
  source: Uint32Array,
  target: Uint32Array,
  counts: Uint32Array,
): void {
  const { nodes, width, column, shift } = input;
  counts.fill(0);
  for (let index = 0; index < source.length; index += 1) {
    const row = source[index] ?? 0;
    const digit = ((nodes[row * width + column] ?? 0) >>> shift) & RADIX_MASK;
    counts[digit] = (counts[digit] ?? 0) + 1;
  }
  let offset = 0;
  for (let digit = 0; digit < counts.length; digit += 1) {
    const count = counts[digit] ?? 0;
    counts[digit] = offset;
    offset += count;
  }
  for (let index = 0; index < source.length; index += 1) {
    const row = source[index] ?? 0;
    const digit = ((nodes[row * width + column] ?? 0) >>> shift) & RADIX_MASK;
    const output = counts[digit] ?? 0;
    target[output] = row;
    counts[digit] = output + 1;
  }
}

/** Orders variable-width canonical Uint32 rows exactly with bounded dense storage. */
export function sortVariableCanonicalRows(offsets: Uint32Array, nodes: Uint32Array): Uint32Array {
  return sortIndexRows(offsets.length - 1, (left, right) =>
    compareVariableCanonicalRows(offsets, nodes, left, right),
  );
}

/** Compares two variable-width canonical rows lexicographically. */
export function compareVariableCanonicalRows(
  offsets: Uint32Array,
  nodes: Uint32Array,
  left: number,
  right: number,
): number {
  const leftStart = offsets[left] ?? 0;
  const leftEnd = offsets[left + 1] ?? leftStart;
  const rightStart = offsets[right] ?? 0;
  const rightEnd = offsets[right + 1] ?? rightStart;
  const shared = Math.min(leftEnd - leftStart, rightEnd - rightStart);
  for (let offset = 0; offset < shared; offset += 1) {
    const difference = (nodes[leftStart + offset] ?? 0) - (nodes[rightStart + offset] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftEnd - leftStart - (rightEnd - rightStart);
}
