import type { MeshEdgeData } from "./mesh-edge";

/** Expanded four-corner draw data for one screen-space authored-edge quad. */
export interface ExpandedMeshEdgeData {
  readonly indices: Uint32Array;
  readonly sourceVertexIndices: Uint32Array;
  readonly edgeIds: Uint32Array;
  readonly positions: Float32Array;
  readonly nodePickIds: Uint32Array;
}

/** Expands each logical edge segment into a displacement-aware indexed quad. */
export function expandMeshEdgeData(
  edgeData: MeshEdgeData,
  sourceNodePickIds: ArrayLike<number> | undefined,
): ExpandedMeshEdgeData {
  const segmentCount = Math.floor(edgeData.indices.length / 2);
  const positions = new Float32Array(segmentCount * 4 * 3);
  const sourceVertexIndices = new Uint32Array(segmentCount * 4);
  const nodePickIds = new Uint32Array(segmentCount * 4);
  const edgeIds = new Uint32Array(segmentCount * 4);
  const indices = new Uint32Array(segmentCount * 6);
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const endpoint = segment * 2;
    const endpointA = edgeData.indices[endpoint] ?? endpoint;
    const endpointB = edgeData.indices[endpoint + 1] ?? endpoint + 1;
    const sourceA = edgeData.sourceVertexIndices[endpointA] ?? 0;
    const sourceB = edgeData.sourceVertexIndices[endpointB] ?? 0;
    const vertex = segment * 4;
    copyEdgePosition(edgeData.positions, endpointA, positions, vertex);
    copyEdgePosition(edgeData.positions, endpointB, positions, vertex + 1);
    copyEdgePosition(edgeData.positions, endpointB, positions, vertex + 2);
    copyEdgePosition(edgeData.positions, endpointA, positions, vertex + 3);
    sourceVertexIndices.set([sourceA, sourceB, sourceB, sourceA], vertex);
    nodePickIds.set(
      [
        sourceNodePickIds?.[sourceA] ?? 0,
        sourceNodePickIds?.[sourceB] ?? 0,
        sourceNodePickIds?.[sourceB] ?? 0,
        sourceNodePickIds?.[sourceA] ?? 0,
      ],
      vertex,
    );
    edgeIds.fill(edgeData.edgeIds[endpointA] ?? 0, vertex, vertex + 4);
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], segment * 6);
  }
  return { indices, sourceVertexIndices, edgeIds, positions, nodePickIds };
}

function copyEdgePosition(
  source: Float32Array,
  sourceIndex: number,
  target: Float32Array,
  targetIndex: number,
): void {
  target.set(source.subarray(sourceIndex * 3, sourceIndex * 3 + 3), targetIndex * 3);
}
