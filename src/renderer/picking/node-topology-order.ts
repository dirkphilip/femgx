import type { ElementTessellation } from "../../geometry/part";

interface NodeOwnerData {
  readonly bodyRanges: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly elementIds: Uint32Array;
}

/** Returns whether authored order already provides canonical body/element owners. */
export function nodeOwnersAreCanonical(elements: readonly ElementTessellation[]): boolean {
  for (let ordinal = 1; ordinal < elements.length; ordinal += 1) {
    const previous = elements[ordinal - 1];
    const current = elements[ordinal];
    if (previous === undefined || current === undefined) continue;
    if ((previous.bodyId ?? -1) > (current.bodyId ?? -1)) return false;
    if ((previous.bodyId ?? -1) === (current.bodyId ?? -1) && previous.id > current.id)
      return false;
  }
  return true;
}

/** Canonicalizes each node's bounded owner slice in place. */
export function sortNodeOwners(output: NodeOwnerData): void {
  const spriteCount = output.bodyRanges.length / 2;
  for (let sprite = 0; sprite < spriteCount; sprite += 1) {
    const start = output.bodyRanges[sprite * 2] ?? 0;
    const count = output.bodyRanges[sprite * 2 + 1] ?? 0;
    if (count > 1) heapSortNodeOwners(output, start, count);
  }
}

function heapSortNodeOwners(output: NodeOwnerData, start: number, count: number): void {
  for (let root = Math.floor(count / 2) - 1; root >= 0; root -= 1) {
    siftNodeOwnerDown(output, start, root, count);
  }
  for (let end = count - 1; end > 0; end -= 1) {
    swapNodeOwners(output, start, start + end);
    siftNodeOwnerDown(output, start, 0, end);
  }
}

function siftNodeOwnerDown(
  output: NodeOwnerData,
  start: number,
  root: number,
  count: number,
): void {
  let current = root;
  while (current * 2 + 1 < count) {
    const left = current * 2 + 1;
    const right = left + 1;
    const largest =
      right < count && compareNodeOwners(output, start + left, start + right) < 0 ? right : left;
    if (compareNodeOwners(output, start + current, start + largest) >= 0) return;
    swapNodeOwners(output, start + current, start + largest);
    current = largest;
  }
}

function compareNodeOwners(output: NodeOwnerData, first: number, second: number): number {
  return (
    (output.bodyIds[first * 2] ?? 0) - (output.bodyIds[second * 2] ?? 0) ||
    (output.elementIds[first * 2] ?? 0) - (output.elementIds[second * 2] ?? 0)
  );
}

function swapNodeOwners(output: NodeOwnerData, first: number, second: number): void {
  swapOwnerPair(output.bodyIds, first, second);
  swapOwnerPair(output.elementIds, first, second);
}

function swapOwnerPair(values: Uint32Array, first: number, second: number): void {
  const firstOffset = first * 2;
  const secondOffset = second * 2;
  const owner = values[firstOffset] ?? 0;
  const neighbor = values[firstOffset + 1] ?? 0;
  values[firstOffset] = values[secondOffset] ?? 0;
  values[firstOffset + 1] = values[secondOffset + 1] ?? 0;
  values[secondOffset] = owner;
  values[secondOffset + 1] = neighbor;
}
