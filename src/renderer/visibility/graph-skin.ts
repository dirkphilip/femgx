import type { PartGeometrySemantic } from "../../geometry/semantic/part-semantic-graph";
import type { VisibilitySignature } from "./types";
import { buildVisibilityTriangleIndices, writeTriangleRange } from "./skin-indices";

/** Builds a hidden-face skin directly from the owning Part graph columns. */
export function buildGraphVisibilitySkinIndices(
  semantic: PartGeometrySemantic,
  signature: VisibilitySignature,
  indexUpperBound: number,
): Uint32Array {
  return buildVisibilityTriangleIndices(indexUpperBound, (target) =>
    writeGraphSkin(semantic, signature, target),
  );
}

function writeGraphSkin(
  semantic: PartGeometrySemantic,
  signature: VisibilitySignature,
  target: Uint32Array | number[] | undefined,
): number {
  const { graph, geometryOrdinal } = semantic;
  const first = graph.faceGeometryOffsets[geometryOrdinal] ?? 0;
  const last = graph.faceGeometryOffsets[geometryOrdinal + 1] ?? first;
  let offset = 0;
  for (let face = first; face < last; face += 1) {
    const ownerOrdinal = graph.faceOwnerElementOrdinals[face] ?? 0;
    const ownerElementId = graph.elementIds[ownerOrdinal] ?? 0;
    const ownerBodyId = graph.faceBodyIds[face] || graph.elementBodyIds[ownerOrdinal] || 0;
    if (
      hidden(signature, ownerElementId, ownerOrdinal) ||
      contains(signature.bodyIds, ownerBodyId === 0 ? undefined : ownerBodyId)
    ) {
      continue;
    }
    const neighborOrdinal = graph.faceNeighborElementOrdinals[face] ?? 0;
    if (neighborOrdinal !== 0) {
      const neighbor = neighborOrdinal - 1;
      const neighborElementId = graph.elementIds[neighbor] ?? 0;
      const neighborBodyId = graph.elementBodyIds[neighbor] ?? 0;
      if (
        !hidden(signature, neighborElementId, neighbor) &&
        !contains(signature.bodyIds, neighborBodyId === 0 ? undefined : neighborBodyId)
      ) {
        continue;
      }
    }
    offset = writeTriangleRange(
      target,
      offset,
      graph.facePrimitiveStarts[face] ?? 0,
      graph.facePrimitiveCounts[face] ?? 0,
    );
  }
  return offset;
}

function hidden(signature: VisibilitySignature, elementId: number, ordinal: number): boolean {
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
