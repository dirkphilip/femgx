import type { TriangleGeometry } from "../geometry/part";

/** Builds a compact index order over selected faces without copying vertices. */
export function buildFaceSubsetIndices(geometry: TriangleGeometry): Uint32Array {
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.faceIds.length === 0) return new Uint32Array();
  const indices: number[] = [];
  for (const face of geometry.faces ?? []) {
    if (
      !subset.faceIds.some(
        (ref) => ref.elementId === face.elementId && ref.faceIndex === face.faceIndex,
      )
    ) {
      continue;
    }
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
