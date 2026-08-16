import type { MeshEdgeData } from "../edges/mesh-edge";

interface TopologyMetadata {
  readonly primitiveIds: ArrayLike<number>;
  readonly edgeIds: ArrayLike<number>;
}

const EMPTY_TOPOLOGY_METADATA: TopologyMetadata = { primitiveIds: [], edgeIds: [] };

/** Packs face records and variable-length topology ownership into one buffer. */
export function packTopologyData(
  faceBodyPickIds: Uint32Array,
  bodyRanges: Uint32Array,
  bodyIds: Uint32Array,
  elementIds: Uint32Array,
  metadata: TopologyMetadata = EMPTY_TOPOLOGY_METADATA,
): Uint32Array {
  const { primitiveIds, edgeIds } = metadata;
  const faceStride = 5;
  const faceRecordCount = Math.floor(faceBodyPickIds.length / faceStride);
  const rangeCount = Math.floor(bodyRanges.length / 2);
  const conditionCount = Math.floor(bodyIds.length / 2);
  const sentinelOnly =
    bodyIds.length <= 2 &&
    elementIds.length <= 2 &&
    bodyIds.every((value) => value === 0) &&
    elementIds.every((value) => value === 0);
  const storedConditionCount = conditionCount > 0 && !sentinelOnly ? conditionCount : 0;
  const storedBodyIds = storedConditionCount === 0 ? new Uint32Array() : bodyIds;
  const storedElementIds = storedConditionCount === 0 ? new Uint32Array() : elementIds;
  const metadataOffset =
    3 + faceBodyPickIds.length + bodyRanges.length + storedBodyIds.length + storedElementIds.length;
  const data = new Uint32Array(metadataOffset + 1 + primitiveIds.length + edgeIds.length);
  data[0] = faceRecordCount;
  data[1] = rangeCount;
  data[2] = storedConditionCount;
  data.set(faceBodyPickIds, 3);
  data.set(bodyRanges, 3 + faceBodyPickIds.length);
  data.set(storedBodyIds, 3 + faceBodyPickIds.length + bodyRanges.length);
  data.set(storedElementIds, 3 + faceBodyPickIds.length + bodyRanges.length + storedBodyIds.length);
  data[metadataOffset] = primitiveIds.length;
  data.set(primitiveIds, metadataOffset + 1);
  data.set(edgeIds, metadataOffset + 1 + primitiveIds.length);
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
