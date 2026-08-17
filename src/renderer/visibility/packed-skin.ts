import type { PackedSemanticStorage } from "../../geometry/packed/packed-semantic";
import type { VisibilitySignature } from "./types";

/** Builds a hidden-face skin directly from packed face ownership columns. */
export function buildPackedVisibilitySkinIndices(
  packed: PackedSemanticStorage,
  signature: VisibilitySignature,
): Uint32Array {
  const indices: number[] = [];
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
      !contains(signature.elementIds, ownerElementId);
    if (!ownerVisible) continue;
    const neighborOrdinal = packed.faceNeighborElementOrdinals[faceOrdinal] ?? 0;
    const neighborElementId =
      neighborOrdinal === 0 ? undefined : packed.elementIds[neighborOrdinal - 1];
    const neighborBodyId =
      neighborOrdinal === 0 ? undefined : (packed.elementBodyIds?.[neighborOrdinal - 1] ?? 0);
    const neighborVisible =
      neighborElementId !== undefined &&
      !contains(signature.bodyIds, neighborBodyId === 0 ? undefined : neighborBodyId) &&
      !contains(signature.elementIds, neighborElementId);
    if (neighborVisible) continue;
    const start = packed.facePrimitiveStarts[faceOrdinal] ?? 0;
    const end = start + (packed.facePrimitiveCounts[faceOrdinal] ?? 0);
    for (let primitive = start; primitive < end; primitive += 1) {
      const base = primitive * 3;
      indices.push(base, base + 1, base + 2);
    }
  }
  return new Uint32Array(indices);
}

function contains(ids: readonly number[], value: number | undefined): boolean {
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
