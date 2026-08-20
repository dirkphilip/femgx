import type { TriangleGeometry } from "../../geometry/part";
import { faceSubsetPrimitiveMask } from "../../geometry/face-validation";
import { geometrySemanticGraph } from "../../geometry/semantic/part-semantic-graph";

/** Builds a compact index order over selected faces without copying vertices. */
export function buildFaceSubsetIndices(geometry: TriangleGeometry): Uint32Array {
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.count === 0) return new Uint32Array();
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    const { graph, geometryOrdinal } = semantic;
    const indices: number[] = [];
    const first = graph.faceSubsetOffsets[geometryOrdinal] ?? 0;
    const last = graph.faceSubsetOffsets[geometryOrdinal + 1] ?? first;
    for (let row = first; row < last; row += 1) {
      const faceOrdinal = graph.faceSubsetOrdinals[row] ?? 0;
      const start = graph.facePrimitiveStarts[faceOrdinal] ?? 0;
      const end = start + (graph.facePrimitiveCounts[faceOrdinal] ?? 0);
      appendPrimitiveIndices(geometry, start, end, indices);
    }
    return new Uint32Array(indices);
  }
  const displayedByPrimitive = faceSubsetPrimitiveMask(geometry);
  if (displayedByPrimitive === undefined) return new Uint32Array();
  const indices: number[] = [];
  const faces = geometry.faces;
  if (faces === undefined) return new Uint32Array();
  for (const face of faces) {
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
