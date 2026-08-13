import type { MeshEdgeData } from "./gpu-edge";
import { createBuffer } from "./gpu-support";

/** Packs expanded positions and edge metadata for shader-side geometry reads. */
export function createGeometryDataBuffer(
  device: GPUDevice,
  positions: Float32Array,
  primitiveIds: Uint32Array,
  edgeData: MeshEdgeData,
): GPUBuffer {
  const data = new Uint32Array(
    2 + positions.length + primitiveIds.length + edgeData.sourceVertexIndices.length * 2,
  );
  data[0] = positions.length;
  data[1] = primitiveIds.length;
  data.set(new Uint32Array(positions.buffer, positions.byteOffset, positions.length), 2);
  data.set(primitiveIds, 2 + positions.length);
  const metadataOffset = 2 + positions.length + primitiveIds.length;
  for (let endpoint = 0; endpoint < edgeData.sourceVertexIndices.length; endpoint += 1) {
    data[metadataOffset + endpoint * 2] = edgeData.sourceVertexIndices[endpoint] ?? 0;
    data[metadataOffset + endpoint * 2 + 1] = edgeData.edgeIds[endpoint] ?? 0;
  }
  return createBuffer(device, data, GPUBufferUsage.STORAGE);
}

/** Packs face records and variable-length topology ownership into one buffer. */
export function packTopologyData(
  faceBodyPickIds: Uint32Array,
  bodyRanges: Uint32Array,
  bodyIds: Uint32Array,
  elementIds: Uint32Array,
): Uint32Array {
  const faceRecordCount = Math.floor(faceBodyPickIds.length / 5);
  const rangeCount = Math.floor(bodyRanges.length / 2);
  const conditionCount = Math.floor(bodyIds.length / 2);
  const data = new Uint32Array(
    3 + faceBodyPickIds.length + bodyRanges.length + bodyIds.length + elementIds.length,
  );
  data[0] = faceRecordCount;
  data[1] = rangeCount;
  data[2] = conditionCount;
  data.set(faceBodyPickIds, 3);
  data.set(bodyRanges, 3 + faceBodyPickIds.length);
  data.set(bodyIds, 3 + faceBodyPickIds.length + bodyRanges.length);
  data.set(elementIds, 3 + faceBodyPickIds.length + bodyRanges.length + bodyIds.length);
  return data;
}

/** Returns a valid empty edge record for parts without mesh edges. */
export function emptyMeshEdgeData(): MeshEdgeData {
  return {
    indices: new Uint32Array(),
    sourceVertexIndices: new Uint32Array(),
    edgeIds: new Uint32Array(),
    positions: new Float32Array(),
    bodyRanges: new Uint32Array([0, 0]),
    bodyIds: new Uint32Array([0]),
    elementIds: new Uint32Array([0]),
  };
}
