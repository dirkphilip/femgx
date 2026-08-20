import type { Geometry, Part } from "../../geometry/part";
import type { SelectionDrawRange } from "../resources/foundation";
import {
  createSubsetBuffers,
  partTopologyData,
  triangleSubsetUploadData,
  type PartSubsetGeometryData,
} from "../resources/geometry-upload";

/** Builds compact vertex and topology buffers for one selected triangle-range union. */
export function buildPartSelectionGeometryData(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  ranges: readonly SelectionDrawRange[],
): PartSubsetGeometryData | undefined {
  const selected = selectedTriangleData(geometry, ranges);
  if (selected === undefined || selected.indices.length === 0) return undefined;
  const { elementOrdinals, neighborElementOrdinals, faceBodyPickIds } = partTopologyData(
    part,
    geometry,
    true,
  );
  const vertexData = triangleSubsetUploadData(geometry, selected.indices);
  const localPrimitiveIds = new Uint32Array(vertexData.primitiveIds.length);
  for (let index = 0; index < localPrimitiveIds.length; index += 1) {
    localPrimitiveIds[index] = Math.floor(index / 3);
  }
  return {
    subsetBuffers: createSubsetBuffers(
      device,
      { ...vertexData, primitiveIds: localPrimitiveIds },
      selectedFaceRecords(faceBodyPickIds, selected.primitiveIds),
      selectedOrdinals(elementOrdinals, selected.primitiveIds),
      selectedNeighborOrdinals(neighborElementOrdinals, selected.primitiveIds),
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

function selectedFaceRecords(records: Uint32Array, primitiveIds: Uint32Array): Uint32Array {
  const selected = new Uint32Array(primitiveIds.length * 5);
  for (let index = 0; index < primitiveIds.length; index += 1) {
    const primitive = primitiveIds[index] ?? 0;
    selected.set(records.subarray(primitive * 5, primitive * 5 + 5), index * 5);
  }
  return selected;
}

function selectedOrdinals(ordinals: Uint32Array, primitiveIds: Uint32Array): Uint32Array {
  const selected = new Uint32Array(primitiveIds.length);
  for (let index = 0; index < primitiveIds.length; index += 1) {
    selected[index] = ordinals[primitiveIds[index] ?? 0] ?? 0;
  }
  return selected;
}

function selectedNeighborOrdinals(
  ordinals: Uint32Array | undefined,
  primitiveIds: Uint32Array,
): Uint32Array | undefined {
  return ordinals === undefined || ordinals.length === 0
    ? undefined
    : selectedOrdinals(ordinals, primitiveIds);
}
