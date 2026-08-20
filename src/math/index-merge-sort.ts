/** Returns row ordinals in stable comparator order using dense typed storage. */
export function sortIndexRows(
  count: number,
  compare: (left: number, right: number) => number,
): Uint32Array {
  const result = new Uint32Array(count);
  const scratch = new Uint32Array(count);
  const state = { compare, source: result, target: scratch };
  for (let index = 0; index < count; index += 1) result[index] = index;
  for (let width = 1; width < count; width *= 2) {
    for (let start = 0; start < count; start += width * 2) {
      mergeIndexRows(
        state,
        start,
        Math.min(start + width, count),
        Math.min(start + width * 2, count),
      );
    }
    result.set(scratch);
  }
  return result;
}

interface MergeState {
  readonly compare: (left: number, right: number) => number;
  readonly source: Uint32Array;
  readonly target: Uint32Array;
}

function mergeIndexRows(state: MergeState, start: number, middle: number, end: number): void {
  const { compare, source, target } = state;
  let left = start;
  let right = middle;
  for (let output = start; output < end; output += 1) {
    const leftRow = source[left] ?? 0;
    const rightRow = source[right] ?? 0;
    if (left < middle && (right >= end || compare(leftRow, rightRow) <= 0)) {
      target[output] = leftRow;
      left += 1;
    } else {
      target[output] = rightRow;
      right += 1;
    }
  }
}
