import type { TriangleGeometry } from "../../geometry/part";
import { faceSubsetIdentityIndex } from "../../geometry/face-validation";
import { faceIdentity } from "../../geometry/element-face-selection";

/** Builds a compact index order over selected faces without copying vertices. */
export function buildFaceSubsetIndices(geometry: TriangleGeometry): Uint32Array {
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.faceIds.length === 0) return new Uint32Array();
  const identities = faceSubsetIdentityIndex(geometry);
  if (identities === undefined) return new Uint32Array();
  const indices: number[] = [];
  for (const face of geometry.faces ?? []) {
    if (!identities.identities.has(faceIdentity(face.elementId, face.faceIndex))) continue;
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
