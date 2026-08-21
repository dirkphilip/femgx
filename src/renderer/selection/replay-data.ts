import type { Geometry, Part } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { SelectionDrawRange } from "../resources/foundation";
import { triangleSubsetUploadData } from "../resources/triangle-upload";
import { createSubsetBuffers } from "./subset-buffers";

interface PartSelectionGeometryData {
  readonly subsetBuffers: ReturnType<typeof createSubsetBuffers>;
  readonly subsetIndices: Uint32Array;
}

/** Builds compact vertex and topology buffers for one selected triangle-range union. */
export function buildPartSelectionGeometryData(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  ranges: readonly SelectionDrawRange[],
): PartSelectionGeometryData | undefined {
  const selected = selectedTriangleData(geometry, ranges);
  if (selected === undefined || selected.indices.length === 0) return undefined;
  const topology = selectedTopology(part, geometry, selected.primitiveIds);
  if (topology === undefined) return undefined;
  const localPrimitiveIds = new Uint32Array(selected.indices.length);
  for (let index = 0; index < localPrimitiveIds.length; index += 1) {
    localPrimitiveIds[index] = Math.floor(index / 3);
  }
  const vertexData = triangleSubsetUploadData(geometry, selected.indices, localPrimitiveIds);
  return {
    subsetBuffers: createSubsetBuffers(
      device,
      vertexData,
      topology.faceRecords,
      topology.elementOrdinals,
      topology.neighborElementOrdinals,
    ),
    subsetIndices: selected.indices,
  };
}

function selectedTriangleData(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  ranges: readonly SelectionDrawRange[],
): { readonly indices: Uint32Array; readonly primitiveIds: Uint32Array } | undefined {
  let count = 0;
  for (const range of ranges) {
    if (
      range.primitive !== "triangles" ||
      range.firstIndex % 3 !== 0 ||
      range.indexCount <= 0 ||
      range.indexCount % 3 !== 0 ||
      range.firstIndex + range.indexCount > geometry.indices.length
    )
      return undefined;
    count += range.indexCount;
  }
  const indices = new Uint32Array(count);
  const primitiveIds = new Uint32Array(count / 3);
  let offset = 0;
  let primitiveOffset = 0;
  for (const range of ranges) {
    indices.set(
      geometry.indices.subarray(range.firstIndex, range.firstIndex + range.indexCount),
      offset,
    );
    offset += range.indexCount;
    const firstPrimitive = range.firstIndex / 3;
    const primitiveCount = range.indexCount / 3;
    for (let primitive = 0; primitive < primitiveCount; primitive += 1) {
      primitiveIds[primitiveOffset + primitive] = firstPrimitive + primitive;
    }
    primitiveOffset += primitiveCount;
  }
  return { indices, primitiveIds };
}

interface SelectedTopology {
  readonly faceRecords: Uint32Array;
  readonly elementOrdinals: Uint32Array;
  readonly neighborElementOrdinals: Uint32Array | undefined;
}

function selectedTopology(
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  primitiveIds: Uint32Array,
): SelectedTopology | undefined {
  const faces = geometry.faces;
  if (faces === undefined) return undefined;
  const metadata = getPartSemanticIndex(part);
  const faceRecords = new Uint32Array(primitiveIds.length * 5);
  const elementOrdinals = new Uint32Array(primitiveIds.length);
  const neighborOrdinals = new Uint32Array(primitiveIds.length);
  let hasNeighbor = false;
  for (let index = 0; index < primitiveIds.length; index += 1) {
    const face = faceForPrimitive(faces, primitiveIds[index] ?? 0);
    if (face === undefined) return undefined;
    const ownerOrdinal = metadata.elementOrdinal(face.value.elementId);
    if (ownerOrdinal === undefined) return undefined;
    const neighborId = face.value.neighborElementId;
    const neighborOrdinal =
      neighborId === undefined ? undefined : metadata.elementOrdinal(neighborId);
    const ownerBodyId = face.value.bodyId ?? metadata.bodyForElement(face.value.elementId);
    const neighborBodyId =
      neighborOrdinal === undefined || neighborId === undefined
        ? undefined
        : metadata.bodyForElement(neighborId);
    const base = index * 5;
    faceRecords[base] = face.ordinal + 1;
    faceRecords[base + 1] = ownerBodyId === undefined ? 0 : ownerBodyId + 1;
    faceRecords[base + 2] =
      neighborBodyId === undefined || neighborBodyId === ownerBodyId ? 0 : neighborBodyId + 1;
    faceRecords[base + 3] = face.value.elementId + 1;
    faceRecords[base + 4] = neighborOrdinal === undefined ? 0 : (neighborId ?? 0) + 1;
    elementOrdinals[index] = ownerOrdinal;
    if (neighborOrdinal !== undefined) {
      neighborOrdinals[index] = neighborOrdinal;
      hasNeighbor = true;
    }
  }
  return {
    faceRecords,
    elementOrdinals,
    neighborElementOrdinals: hasNeighbor ? neighborOrdinals : undefined,
  };
}

function faceForPrimitive(
  faces: NonNullable<Extract<Geometry, { primitive: "triangles" }>["faces"]>,
  primitive: number,
) {
  let low = 0;
  let high = faces.count - 1;
  while (low <= high) {
    const ordinal = (low + high) >>> 1;
    const face = faces.at(ordinal);
    if (face === undefined) return undefined;
    if (primitive < face.primitiveStart) high = ordinal - 1;
    else if (primitive >= face.primitiveStart + face.primitiveCount) low = ordinal + 1;
    else return { ordinal, value: face };
  }
  return undefined;
}
