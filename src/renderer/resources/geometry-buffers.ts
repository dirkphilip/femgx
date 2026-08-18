import type { MeshEdgeData } from "../edges/mesh-edge";

interface TopologyMetadata {
  readonly elementOrdinals: ArrayLike<number>;
  readonly primitiveIds: ArrayLike<number>;
  readonly edgeIds: ArrayLike<number>;
}

const EMPTY_TOPOLOGY_METADATA: TopologyMetadata = {
  elementOrdinals: [],
  primitiveIds: [],
  edgeIds: [],
};

/** Packs face records and variable-length topology ownership into one buffer. */
export function packTopologyData(
  faceBodyPickIds: Uint32Array,
  bodyRanges: Uint32Array,
  bodyIds: Uint32Array,
  elementIds: Uint32Array,
  metadata: TopologyMetadata = EMPTY_TOPOLOGY_METADATA,
): Uint32Array {
  const { elementOrdinals, primitiveIds, edgeIds } = metadata;
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
    4 + faceBodyPickIds.length + bodyRanges.length + storedBodyIds.length + storedElementIds.length;
  const primitiveIdsOffset = metadataOffset + elementOrdinals.length;
  const data = new Uint32Array(primitiveIdsOffset + 1 + primitiveIds.length + edgeIds.length);
  data[0] = faceRecordCount;
  data[1] = rangeCount;
  data[2] = storedConditionCount;
  data[3] = elementOrdinals.length;
  data.set(faceBodyPickIds, 4);
  data.set(bodyRanges, 4 + faceBodyPickIds.length);
  data.set(storedBodyIds, 4 + faceBodyPickIds.length + bodyRanges.length);
  data.set(storedElementIds, 4 + faceBodyPickIds.length + bodyRanges.length + storedBodyIds.length);
  data.set(elementOrdinals, metadataOffset);
  data[primitiveIdsOffset] = primitiveIds.length;
  data.set(primitiveIds, primitiveIdsOffset + 1);
  data.set(edgeIds, primitiveIdsOffset + 1 + primitiveIds.length);
  return data;
}

/** Packs bodyless/faceless edge topology directly from dense primitive element ids. */
export function packUnownedEdgeTopologyData(
  edgeData: MeshEdgeData,
  elementOrdinals: ArrayLike<number>,
  primitiveElementPickIds: Uint32Array,
  edgeIds: ArrayLike<number>,
): Uint32Array {
  const faceStride = 5;
  const faceDataLength = primitiveElementPickIds.length * faceStride;
  const rangeCount = Math.floor(edgeData.bodyRanges.length / 2);
  const conditionCount = Math.floor(edgeData.bodyIds.length / 2);
  const sentinelOnly =
    edgeData.bodyIds.length <= 2 &&
    edgeData.elementIds.length <= 2 &&
    edgeData.bodyIds.every((value) => value === 0) &&
    edgeData.elementIds.every((value) => value === 0);
  const storedConditionCount = conditionCount > 0 && !sentinelOnly ? conditionCount : 0;
  const storedBodyIds = storedConditionCount === 0 ? new Uint32Array() : edgeData.bodyIds;
  const storedElementIds = storedConditionCount === 0 ? new Uint32Array() : edgeData.elementIds;
  const metadataOffset =
    4 +
    faceDataLength +
    edgeData.bodyRanges.length +
    storedBodyIds.length +
    storedElementIds.length;
  const primitiveIdsOffset = metadataOffset + elementOrdinals.length;
  const data = new Uint32Array(primitiveIdsOffset + 1 + edgeIds.length);
  data[0] = primitiveElementPickIds.length;
  data[1] = rangeCount;
  data[2] = storedConditionCount;
  data[3] = elementOrdinals.length;
  for (let primitive = 0; primitive < primitiveElementPickIds.length; primitive += 1) {
    data[4 + primitive * faceStride + 3] = primitiveElementPickIds[primitive] ?? 0;
  }
  let offset = 4 + faceDataLength;
  data.set(edgeData.bodyRanges, offset);
  offset += edgeData.bodyRanges.length;
  data.set(storedBodyIds, offset);
  offset += storedBodyIds.length;
  data.set(storedElementIds, offset);
  data.set(elementOrdinals, metadataOffset);
  data[primitiveIdsOffset] = 0;
  data.set(edgeIds, primitiveIdsOffset + 1);
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
