import { FaceSelectionError, type FaceIdRef } from "../../elements/faces";
import { ordinalForId } from "../../elements/model-storage";
import type { DirectFaceSources } from "./direct-face-columns";
import type { FaceColumns } from "./face-columns";
import type { GeometryInput } from "../types";

/**
 * Builds typed subset columns for descriptor-authored triangle geometry.
 * @internal
 */
export function geometryFaceSubsetColumns(
  geometries: readonly GeometryInput[],
  faces: Pick<FaceColumns, "faceOwnerElementOrdinals" | "faceIndices" | "faceLookupOrdinals">,
  elementIds: Uint32Array,
  elementIdOrdinals: Uint32Array,
): { readonly offsets: Uint32Array; readonly ordinals: Uint32Array; readonly defined: Uint8Array } {
  const offsets = new Uint32Array(geometries.length + 1);
  const defined = new Uint8Array(geometries.length);
  let count = 0;
  for (let geometryOrdinal = 0; geometryOrdinal < geometries.length; geometryOrdinal += 1) {
    const geometry = geometries[geometryOrdinal];
    if (geometry?.primitive === "triangles") {
      count += geometry.faceSubset?.faceIds.length ?? 0;
      defined[geometryOrdinal] = geometry.faceSubset === undefined ? 0 : 1;
    }
    offsets[geometryOrdinal + 1] = count;
  }
  const ordinals = new Uint32Array(count);
  let output = 0;
  for (const geometry of geometries) {
    if (geometry.primitive !== "triangles") continue;
    for (const reference of geometry.faceSubset?.faceIds ?? []) {
      const face = geometryFaceOrdinal(
        faces,
        elementIds,
        elementIdOrdinals,
        reference.elementId,
        reference.faceIndex,
      );
      if (face === undefined)
        throw new Error(
          `Subset references unknown face ${reference.elementId}/${reference.faceIndex}`,
        );
      ordinals[output++] = face;
    }
  }
  return { offsets, ordinals, defined };
}

function geometryFaceOrdinal(
  faces: Pick<FaceColumns, "faceOwnerElementOrdinals" | "faceIndices" | "faceLookupOrdinals">,
  elementIds: Uint32Array,
  elementIdOrdinals: Uint32Array,
  elementId: number,
  faceIndex: number,
): number | undefined {
  const ownerOrdinal = ordinalForId(elementIds, elementIdOrdinals, elementId);
  if (ownerOrdinal === undefined) return undefined;
  let low = 0;
  let high = faces.faceLookupOrdinals.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const ordinal = faces.faceLookupOrdinals[middle] ?? 0;
    const owner = faces.faceOwnerElementOrdinals[ordinal] ?? 0;
    const candidateIndex = faces.faceIndices[ordinal] ?? 0;
    if (owner === ownerOrdinal && candidateIndex === faceIndex) return ordinal;
    if (owner < ownerOrdinal || (owner === ownerOrdinal && candidateIndex < faceIndex))
      low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

/** Resolves explicit face identities to direct face-source row ordinals. */
export function resolveDirectFaceSubset(
  source: DirectFaceSources,
  selection: readonly FaceIdRef[],
): Uint32Array {
  const ids = new Uint32Array(selection.length);
  const indices = new Uint32Array(selection.length);
  readSelection(selection, ids, indices);
  return resolveSelectionRows(source, ids, indices);
}

function readSelection(
  selection: readonly FaceIdRef[],
  ids: Uint32Array,
  indices: Uint32Array,
): void {
  for (let index = 0; index < selection.length; index += 1) {
    const ref = selection[index];
    if (ref === undefined || !Number.isInteger(ref.elementId) || ref.elementId < 0) {
      throw new FaceSelectionError(
        "invalid-element-id",
        "Face subset references an invalid element",
      );
    }
    if (!Number.isInteger(ref.faceIndex) || ref.faceIndex < 0) {
      throw new FaceSelectionError(
        "invalid-face-index",
        `Face subset references invalid face index ${String(ref.faceIndex)}`,
      );
    }
    ids[index] = ref.elementId;
    indices[index] = ref.faceIndex;
  }
}

function resolveSelectionRows(
  source: DirectFaceSources,
  ids: Uint32Array,
  indices: Uint32Array,
): Uint32Array {
  const selectionOrder = sortedPairRows(ids, indices);
  const faceOrder = sortedPairRows(source.elementIds, source.faceIndices);
  const result = new Uint32Array(ids.length);
  let face = 0;
  for (let sorted = 0; sorted < selectionOrder.length; sorted += 1) {
    const row = selectionOrder[sorted] ?? 0;
    const elementId = ids[row] ?? 0;
    const faceIndex = indices[row] ?? 0;
    rejectDuplicateSelection(ids, indices, selectionOrder, sorted, elementId, faceIndex);
    while (
      face < faceOrder.length &&
      pairBefore(source.elementIds, source.faceIndices, faceOrder[face] ?? 0, elementId, faceIndex)
    )
      face += 1;
    const candidate = faceOrder[face] ?? 0;
    if (
      face >= faceOrder.length ||
      source.elementIds[candidate] !== elementId ||
      source.faceIndices[candidate] !== faceIndex
    ) {
      rejectUnknownSelection(source, faceOrder, face, elementId, faceIndex);
    }
    result[row] = candidate;
  }
  return result;
}

// Pair columns are intentionally passed explicitly to keep this typed sort allocation-free.
// eslint-disable-next-line max-params
function rejectDuplicateSelection(
  ids: Uint32Array,
  indices: Uint32Array,
  order: Uint32Array,
  sorted: number,
  elementId: number,
  faceIndex: number,
): void {
  if (sorted === 0) return;
  const previous = order[sorted - 1] ?? 0;
  if (elementId === (ids[previous] ?? 0) && faceIndex === (indices[previous] ?? 0)) {
    throw new FaceSelectionError(
      "duplicate-face",
      `Face subset repeats element ${elementId} face ${faceIndex}`,
    );
  }
}

function rejectUnknownSelection(
  source: DirectFaceSources,
  order: Uint32Array,
  cursor: number,
  elementId: number,
  faceIndex: number,
): never {
  const sameElement =
    (cursor < order.length && source.elementIds[order[cursor] ?? 0] === elementId) ||
    (cursor > 0 && source.elementIds[order[cursor - 1] ?? 0] === elementId);
  throw sameElement
    ? new FaceSelectionError(
        "invalid-face-index",
        `Element ${elementId} has no face at index ${faceIndex}`,
      )
    : new FaceSelectionError(
        "invalid-element-id",
        `Face subset references element ${elementId} outside heterogeneous elements`,
      );
}

function sortedPairRows(ids: Uint32Array, indices: Uint32Array): Uint32Array {
  const result = new Uint32Array(ids.length);
  const scratch = new Uint32Array(ids.length);
  for (let index = 0; index < result.length; index += 1) result[index] = index;
  for (let width = 1; width < result.length; width *= 2) {
    for (let start = 0; start < result.length; start += width * 2)
      mergePairRows(
        ids,
        indices,
        result,
        scratch,
        start,
        Math.min(start + width, result.length),
        Math.min(start + width * 2, result.length),
      );
    result.set(scratch);
  }
  return result;
}

// This is the linear merge kernel for the two typed pair columns.
// eslint-disable-next-line max-params
function mergePairRows(
  ids: Uint32Array,
  indices: Uint32Array,
  source: Uint32Array,
  target: Uint32Array,
  start: number,
  middle: number,
  end: number,
): void {
  let left = start;
  let right = middle;
  for (let output = start; output < end; output += 1) {
    const leftRow = source[left] ?? 0;
    const rightRow = source[right] ?? 0;
    if (left < middle && (right >= end || pairCompare(ids, indices, leftRow, rightRow) <= 0)) {
      target[output] = leftRow;
      left += 1;
    } else {
      target[output] = rightRow;
      right += 1;
    }
  }
}

function pairBefore(
  ids: Uint32Array,
  indices: Uint32Array,
  row: number,
  elementId: number,
  faceIndex: number,
): boolean {
  return (
    (ids[row] ?? 0) < elementId ||
    ((ids[row] ?? 0) === elementId && (indices[row] ?? 0) < faceIndex)
  );
}

function pairCompare(ids: Uint32Array, indices: Uint32Array, left: number, right: number): number {
  return (ids[left] ?? 0) - (ids[right] ?? 0) || (indices[left] ?? 0) - (indices[right] ?? 0);
}
