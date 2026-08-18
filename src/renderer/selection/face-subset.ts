import type { TriangleGeometry } from "../../geometry/part";
import { faceSubsetPrimitiveMask } from "../../geometry/face-validation";
import { packedSemanticStorageForGeometry } from "../../geometry/packed/packed-semantic";

/** Builds a compact index order over selected faces without copying vertices. */
export function buildFaceSubsetIndices(geometry: TriangleGeometry): Uint32Array {
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.faceIds.length === 0) return new Uint32Array();
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed?.faceSubsetOrdinals !== undefined) {
    const indices: number[] = [];
    for (const faceOrdinal of packed.faceSubsetOrdinals) {
      const start = packed.facePrimitiveStarts[faceOrdinal] ?? 0;
      const end = start + (packed.facePrimitiveCounts[faceOrdinal] ?? 0);
      appendPrimitiveIndices(geometry, start, end, indices);
    }
    return new Uint32Array(indices);
  }
  const displayedByPrimitive = faceSubsetPrimitiveMask(geometry);
  if (displayedByPrimitive === undefined) return new Uint32Array();
  const indices: number[] = [];
  for (const face of geometry.faces ?? []) {
    if (displayedByPrimitive[face.primitiveStart] !== 1) continue;
    for (
      let triangle = face.primitiveStart;
      triangle < face.primitiveStart + face.primitiveCount;
      triangle += 1
    ) {
      const base = triangle * 3;
      indices.push(
        geometry.indices[base] ?? 0,
        geometry.indices[base + 1] ?? 0,
        geometry.indices[base + 2] ?? 0,
      );
    }
  }
  return new Uint32Array(indices);
}

function appendPrimitiveIndices(
  geometry: TriangleGeometry,
  start: number,
  end: number,
  indices: number[],
): void {
  for (let triangle = start; triangle < end; triangle += 1) {
    const base = triangle * 3;
    indices.push(
      geometry.indices[base] ?? 0,
      geometry.indices[base + 1] ?? 0,
      geometry.indices[base + 2] ?? 0,
    );
  }
}
