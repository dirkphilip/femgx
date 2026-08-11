import type { Geometry } from "../geometry/part";

/** Builds a compact index order over selected faces without copying vertices. */
export function buildFaceSubsetIndices(geometry: Geometry): Uint32Array {
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.faceIds.length === 0) return new Uint32Array();
  const selected = new Set(subset.faceIds.map((faceId) => faceId + 1));
  const facePickIds = geometry.facePickIds ?? new Uint32Array();
  const indices: number[] = [];
  for (let triangle = 0; triangle < facePickIds.length; triangle += 1) {
    if (!selected.has(facePickIds[triangle] ?? 0)) continue;
    const base = triangle * 3;
    indices.push(
      geometry.indices[base] ?? 0,
      geometry.indices[base + 1] ?? 0,
      geometry.indices[base + 2] ?? 0,
    );
  }
  return new Uint32Array(indices);
}
