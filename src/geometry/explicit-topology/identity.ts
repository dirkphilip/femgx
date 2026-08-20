import { ExplicitTopologyError } from "../polygon-triangulation";
import { sortIndexRows } from "../../math/index-merge-sort";

/** Rejects repeated oriented faces with typed sorting instead of string keys. */
export function validateUniqueSurfaceFaces(
  elementIds: Uint32Array,
  faceIndices: Uint32Array,
): void {
  if (elementIds.length < 2) return;
  const order = sortedFaceRows(elementIds, faceIndices);
  let earliestDuplicate = Number.POSITIVE_INFINITY;
  let duplicateElement = 0;
  let duplicateFace = 0;
  for (let start = 0; start < order.length;) {
    const firstRow = order[start] ?? 0;
    const elementId = elementIds[firstRow] ?? 0;
    const faceIndex = faceIndices[firstRow] ?? 0;
    let end = start + 1;
    let lowest = firstRow;
    let secondLowest = Number.POSITIVE_INFINITY;
    while (
      end < order.length &&
      elementIds[order[end] ?? 0] === elementId &&
      faceIndices[order[end] ?? 0] === faceIndex
    ) {
      const row = order[end] ?? 0;
      if (row < lowest) {
        secondLowest = lowest;
        lowest = row;
      } else if (row < secondLowest) {
        secondLowest = row;
      }
      end += 1;
    }
    if (secondLowest < earliestDuplicate) {
      earliestDuplicate = secondLowest;
      duplicateElement = elementId;
      duplicateFace = faceIndex;
    }
    start = end;
  }
  if (earliestDuplicate < Number.POSITIVE_INFINITY) {
    throw new ExplicitTopologyError(
      "duplicate-face",
      `Surface repeats oriented face ${duplicateElement}/${duplicateFace}`,
    );
  }
}

function sortedFaceRows(elementIds: Uint32Array, faceIndices: Uint32Array): Uint32Array {
  return sortIndexRows(elementIds.length, (left, right) =>
    faceRowOrder(elementIds, faceIndices, left, right),
  );
}

function faceRowOrder(
  elementIds: Uint32Array,
  faceIndices: Uint32Array,
  left: number,
  right: number,
): number {
  const elements = (elementIds[left] ?? 0) - (elementIds[right] ?? 0);
  return elements === 0 ? (faceIndices[left] ?? 0) - (faceIndices[right] ?? 0) : elements;
}
