import type { PackedSemanticStorage } from "../../geometry/packed/packed-semantic";
import type { VisibilitySignature } from "./types";
import { buildVisibilityTriangleIndices, writeTriangleRange } from "./skin-indices";

/** Builds a hidden-face skin directly from packed face ownership columns. */
export function buildPackedVisibilitySkinIndices(
  packed: PackedSemanticStorage,
  signature: VisibilitySignature,
  indexUpperBound: number,
): Uint32Array {
  return buildVisibilityTriangleIndices(indexUpperBound, (target) =>
    writePackedSkin(packed, signature, target),
  );
}

function writePackedSkin(
  packed: PackedSemanticStorage,
  signature: VisibilitySignature,
  target: Uint32Array | number[] | undefined,
): number {
  let offset = 0;
  for (
    let faceOrdinal = 0;
    faceOrdinal < packed.faceOwnerElementOrdinals.length;
    faceOrdinal += 1
  ) {
    const ownerOrdinal = packed.faceOwnerElementOrdinals[faceOrdinal] ?? 0;
    const ownerElementId = packed.elementIds[ownerOrdinal] ?? 0;
    const ownerBodyId = packed.elementBodyIds?.[ownerOrdinal] ?? 0;
    const ownerVisible =
      !contains(signature.bodyIds, ownerBodyId === 0 ? undefined : ownerBodyId) &&
      !elementHidden(signature, ownerElementId, ownerOrdinal);
    if (!ownerVisible) continue;
    const neighborOrdinal = packed.faceNeighborElementOrdinals[faceOrdinal] ?? 0;
    const neighborElementId =
      neighborOrdinal === 0 ? undefined : packed.elementIds[neighborOrdinal - 1];
    const neighborBodyId =
      neighborOrdinal === 0 ? undefined : (packed.elementBodyIds?.[neighborOrdinal - 1] ?? 0);
    const neighborVisible =
      neighborElementId !== undefined &&
      !contains(signature.bodyIds, neighborBodyId === 0 ? undefined : neighborBodyId) &&
      !elementHidden(signature, neighborElementId, neighborOrdinal - 1);
    if (neighborVisible) continue;
    const start = packed.facePrimitiveStarts[faceOrdinal] ?? 0;
    offset = writeTriangleRange(
      target,
      offset,
      start,
      packed.facePrimitiveCounts[faceOrdinal] ?? 0,
    );
  }
  return offset;
}

function elementHidden(
  signature: VisibilitySignature,
  elementId: number,
  ordinal: number,
): boolean {
  const words = signature.elementWords;
  if (words === undefined) return contains(signature.elementIds, elementId);
  return ((words[ordinal >> 5] ?? 0) & (1 << (ordinal & 31))) !== 0;
}

function contains(ids: ArrayLike<number>, value: number | undefined): boolean {
  if (value === undefined) return false;
  let low = 0;
  let high = ids.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = ids[middle];
    if (candidate === value) return true;
    if ((candidate ?? 0) < value) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}
