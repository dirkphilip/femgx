import type { MeshEdgeData } from "../edges/mesh-edge";

interface TopologyMetadata {
  readonly elementOrdinals: ArrayLike<number>;
  readonly neighborElementOrdinals?: ArrayLike<number>;
  readonly conditionElementOrdinals?: ArrayLike<number>;
  readonly primitiveIds: ArrayLike<number>;
  readonly edgeIds: ArrayLike<number>;
  /** Optional triangle corner-to-source connectivity for feature draws. */
  readonly cornerIndices?: ArrayLike<number>;
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
  const { elementOrdinals, primitiveIds, edgeIds, cornerIndices } = metadata;
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
  const conditionElementOrdinals =
    metadata.conditionElementOrdinals ?? new Uint32Array(storedConditionCount * 2);
  const storedBodyIds = storedConditionCount === 0 ? new Uint32Array() : bodyIds;
  const storedElementIds = storedConditionCount === 0 ? new Uint32Array() : elementIds;
  const storedConditionOrdinals =
    storedConditionCount === 0 ? new Uint32Array() : conditionElementOrdinals;
  const neighborElementOrdinals = metadata.neighborElementOrdinals ?? new Uint32Array();
  const metadataOffset =
    5 +
    faceBodyPickIds.length +
    bodyRanges.length +
    storedBodyIds.length +
    storedElementIds.length +
    storedConditionOrdinals.length;
  const primitiveIdsOffset =
    metadataOffset + elementOrdinals.length + neighborElementOrdinals.length;
  const cornerIndexCount = cornerIndices?.length ?? 0;
  const data = new Uint32Array(
    primitiveIdsOffset + 1 + primitiveIds.length + edgeIds.length + cornerIndexCount,
  );
  data[0] = faceRecordCount;
  data[1] = rangeCount;
  data[2] = storedConditionCount;
  data[3] = elementOrdinals.length;
  data[4] = neighborElementOrdinals.length;
  data.set(faceBodyPickIds, 5);
  data.set(bodyRanges, 5 + faceBodyPickIds.length);
  data.set(storedBodyIds, 5 + faceBodyPickIds.length + bodyRanges.length);
  data.set(storedElementIds, 5 + faceBodyPickIds.length + bodyRanges.length + storedBodyIds.length);
  data.set(
    storedConditionOrdinals,
    5 + faceBodyPickIds.length + bodyRanges.length + storedBodyIds.length + storedElementIds.length,
  );
  data.set(elementOrdinals, metadataOffset);
  data.set(neighborElementOrdinals, metadataOffset + elementOrdinals.length);
  data[primitiveIdsOffset] = primitiveIds.length;
  data.set(primitiveIds, primitiveIdsOffset + 1);
  data.set(edgeIds, primitiveIdsOffset + 1 + primitiveIds.length);
  if (cornerIndexCount > 0)
    data.set(cornerIndices ?? [], primitiveIdsOffset + 1 + primitiveIds.length + edgeIds.length);
  return data;
}

/** Packs bodyless/faceless edge topology directly from dense primitive element ids. */
export function packUnownedEdgeTopologyData(
  edgeData: MeshEdgeData,
  elementOrdinals: ArrayLike<number>,
  primitiveElementPickIds: Uint32Array,
  edgeIds: ArrayLike<number>,
  elementOrdinal: (elementPickId: number) => number,
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
  const storedElementOrdinals = new Uint32Array(storedElementIds.length);
  for (let index = 0; index < storedElementIds.length; index += 1) {
    storedElementOrdinals[index] = elementOrdinal(storedElementIds[index] ?? 0);
  }
  const metadataOffset =
    5 +
    faceDataLength +
    edgeData.bodyRanges.length +
    storedBodyIds.length +
    storedElementIds.length +
    storedElementOrdinals.length;
  const primitiveIdsOffset = metadataOffset + elementOrdinals.length;
  const data = new Uint32Array(primitiveIdsOffset + 1 + edgeIds.length);
  data[0] = primitiveElementPickIds.length;
  data[1] = rangeCount;
  data[2] = storedConditionCount;
  data[3] = elementOrdinals.length;
  data[4] = 0;
  for (let primitive = 0; primitive < primitiveElementPickIds.length; primitive += 1) {
    data[5 + primitive * faceStride + 3] = primitiveElementPickIds[primitive] ?? 0;
  }
  let offset = 5 + faceDataLength;
  data.set(edgeData.bodyRanges, offset);
  offset += edgeData.bodyRanges.length;
  data.set(storedBodyIds, offset);
  offset += storedBodyIds.length;
  data.set(storedElementIds, offset);
  offset += storedElementIds.length;
  data.set(storedElementOrdinals, offset);
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

/** Maps one pick id per topology condition to the private element ordinal. */
export function conditionElementOrdinals(
  elementPickIds: Uint32Array,
  ordinal: (elementPickId: number) => number | undefined,
): Uint32Array {
  const ordinals = new Uint32Array(elementPickIds.length);
  for (let index = 0; index < elementPickIds.length; index += 1) {
    const pickId = elementPickIds[index] ?? 0;
    if (pickId !== 0) ordinals[index] = ordinal(pickId) ?? 0;
  }
  return ordinals;
}

/** Maps face-record neighbor picks to private element ordinals when needed. */
export function neighborElementOrdinals(
  faceBodyPickIds: Uint32Array,
  elementOrdinal: (elementId: number) => number | undefined,
): Uint32Array {
  const ordinals = new Uint32Array(faceBodyPickIds.length / 5);
  let hasNeighbor = false;
  for (let primitive = 0; primitive < ordinals.length; primitive += 1) {
    const pickId = faceBodyPickIds[primitive * 5 + 4] ?? 0;
    if (pickId === 0) continue;
    const ordinal = elementOrdinal(pickId - 1);
    if (ordinal === undefined) continue;
    ordinals[primitive] = ordinal;
    hasNeighbor = true;
  }
  return hasNeighbor ? ordinals : new Uint32Array();
}
