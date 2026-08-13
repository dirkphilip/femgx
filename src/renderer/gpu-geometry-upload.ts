import type { Part } from "../geometry/part";
import { buildMeshEdgeData, type MeshEdgeData } from "./gpu-edge";
import { buildFaceSubsetIndices } from "./gpu-face-subset";
import { emptyMeshEdgeData, packTopologyData } from "./gpu-geometry-buffers";
import { buildElementPrimitivePickIds, buildPrimitiveFaceBodyPickData } from "./gpu-pick-ids";
import {
  buildEdgeNodePickIds,
  expandSurfaceGeometry,
  type SurfaceVertexData,
} from "./gpu-surface-geometry";
import { createBuffer, type PartResource } from "./gpu-support";
import { appendResultColorTail, type ResultColorTail } from "./gpu-result-colors";

/** Expanded vertex data shared by surface and point upload paths. */
export interface UploadVertexData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
  readonly primitiveIds: Uint32Array;
}

/** Geometry buffers and metadata assembled for one cached part resource. */
export interface PartGeometryData {
  readonly picks: Pick<PartResource, "elementPickIdsBuffer" | "nodePickIdsBuffer">;
  readonly facePickIdsBuffer: GPUBuffer;
  readonly edgeBuffers: Pick<
    PartResource,
    "edgeVertexBuffer" | "edgeIndexBuffer" | "edgeNodePickIdsBuffer"
  >;
  readonly edgeResultColorBinding: { readonly buffer: GPUBuffer; readonly offset: number };
  readonly edgeData: MeshEdgeData;
  readonly subsetBuffers: ReturnType<typeof createSubsetBuffers>;
  readonly subsetResultColorBinding:
    { readonly buffer: GPUBuffer; readonly offset: number } | undefined;
  readonly subsetEdgeResultColorBinding:
    { readonly buffer: GPUBuffer; readonly offset: number } | undefined;
  readonly subsetIndices: Uint32Array | undefined;
  readonly hasSubset: boolean;
}

/** Builds all non-position buffers and appended result-color bindings for a part. */
export function buildPartGeometryData(
  device: GPUDevice,
  part: Part,
  vertexData: UploadVertexData,
  resultTail: ResultColorTail,
): PartGeometryData {
  const triangleGeometry = part.geometry.primitive === "triangles" ? part.geometry : undefined;
  const subsetIndices = getSubsetIndices(triangleGeometry);
  const edgeData = getEdgeData(triangleGeometry, subsetIndices);
  const picks = uploadPickBuffers(device, part, vertexData.nodePickIds);
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(part.geometry);
  const facePickIdsBuffer = createTopologyBuffer(device, faceBodyPickIds, edgeData, {
    primitiveIds: vertexData.primitiveIds,
    edgeIds: edgeData.edgeIds,
  });
  const { resultColorBinding: edgeResultColorBinding, ...edgeBuffers } = createEdgeBuffers(
    device,
    edgeData,
    part.geometry.nodePickIds,
    resultTail,
  );
  const subsetVertexData =
    triangleGeometry === undefined || subsetIndices === undefined
      ? undefined
      : expandSurfaceGeometry(triangleGeometry, subsetIndices);
  const { subsetResultColorBinding, subsetEdgeResultColorBinding, ...subsetBuffers } =
    createSubsetBuffers(device, subsetVertexData, edgeData, faceBodyPickIds, resultTail);
  return {
    picks,
    facePickIdsBuffer,
    edgeBuffers,
    edgeResultColorBinding,
    edgeData,
    subsetBuffers,
    subsetResultColorBinding,
    subsetEdgeResultColorBinding,
    subsetIndices,
    hasSubset: triangleGeometry?.faceSubset !== undefined,
  };
}

function uploadPickBuffers(
  device: GPUDevice,
  part: Part,
  nodePickIds: Uint32Array,
): Pick<PartResource, "elementPickIdsBuffer" | "nodePickIdsBuffer"> {
  return {
    elementPickIdsBuffer: createBuffer(
      device,
      buildElementPrimitivePickIds(part.geometry),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(device, nodePickIds, GPUBufferUsage.STORAGE),
  };
}

function getSubsetIndices(
  geometry: Extract<Part["geometry"], { primitive: "triangles" }> | undefined,
): Uint32Array | undefined {
  return geometry?.faceSubset === undefined ? undefined : buildFaceSubsetIndices(geometry);
}

function getEdgeData(
  geometry: Extract<Part["geometry"], { primitive: "triangles" }> | undefined,
  subsetIndices: Uint32Array | undefined,
): MeshEdgeData {
  return geometry === undefined
    ? emptyMeshEdgeData()
    : buildMeshEdgeData(geometry, subsetIndices ?? geometry.indices);
}

function createTopologyBuffer(
  device: GPUDevice,
  faceBodyPickIds: Uint32Array,
  edgeData: MeshEdgeData,
  metadata: { readonly primitiveIds: ArrayLike<number>; readonly edgeIds: ArrayLike<number> },
): GPUBuffer {
  return createBuffer(
    device,
    packTopologyData(
      faceBodyPickIds,
      edgeData.bodyRanges,
      edgeData.bodyIds,
      edgeData.elementIds,
      metadata,
    ),
    GPUBufferUsage.STORAGE,
  );
}

function createSubsetBuffers(
  device: GPUDevice,
  vertexData: SurfaceVertexData | undefined,
  edgeData: MeshEdgeData,
  faceBodyPickIds: Uint32Array,
  resultTail: ResultColorTail,
): {
  readonly subsetIndexBuffer?: GPUBuffer;
  readonly subsetVertexBuffer?: GPUBuffer;
  readonly subsetNodePickIdsBuffer?: GPUBuffer;
  readonly subsetTopologyBuffer?: GPUBuffer;
  readonly subsetEdgeVertexBuffer?: GPUBuffer;
  readonly subsetEdgeIndexBuffer?: GPUBuffer;
  readonly subsetResultColorBinding?: { readonly buffer: GPUBuffer; readonly offset: number };
  readonly subsetEdgeResultColorBinding?: {
    readonly buffer: GPUBuffer;
    readonly offset: number;
  };
} {
  if (vertexData === undefined) return {};
  const subsetVertexWithResults = appendResultColorTail(vertexData.positions, resultTail);
  const subsetEdgeWithResults = appendResultColorTail(edgeData.positions, resultTail);
  const subsetVertexBuffer = createGeometryBuffer(device, subsetVertexWithResults.data);
  const subsetEdgeVertexBuffer = createGeometryBuffer(device, subsetEdgeWithResults.data);
  return {
    subsetIndexBuffer: createIndexBuffer(device, vertexData.indices),
    subsetVertexBuffer,
    subsetNodePickIdsBuffer: createBuffer(device, vertexData.nodePickIds, GPUBufferUsage.STORAGE),
    subsetTopologyBuffer: createTopologyBuffer(device, faceBodyPickIds, edgeData, {
      primitiveIds: vertexData.primitiveIds,
      edgeIds: edgeData.edgeIds,
    }),
    subsetEdgeVertexBuffer,
    subsetEdgeIndexBuffer: createIndexBuffer(device, edgeData.indices),
    subsetResultColorBinding: {
      buffer: subsetVertexBuffer,
      offset: subsetVertexWithResults.offset,
    },
    subsetEdgeResultColorBinding: {
      buffer: subsetEdgeVertexBuffer,
      offset: subsetEdgeWithResults.offset,
    },
  };
}

function createEdgeBuffers(
  device: GPUDevice,
  edgeData: MeshEdgeData,
  sourceNodePickIds: Uint32Array | undefined,
  resultTail: ResultColorTail,
): {
  readonly edgeVertexBuffer: GPUBuffer;
  readonly edgeIndexBuffer: GPUBuffer;
  readonly edgeNodePickIdsBuffer: GPUBuffer;
  readonly resultColorBinding: { readonly buffer: GPUBuffer; readonly offset: number };
} {
  const edgeWithResults = appendResultColorTail(edgeData.positions, resultTail);
  const edgeVertexBuffer = createGeometryBuffer(device, edgeWithResults.data);
  return {
    edgeVertexBuffer,
    edgeIndexBuffer: createIndexBuffer(device, edgeData.indices),
    edgeNodePickIdsBuffer: createBuffer(
      device,
      buildEdgeNodePickIds(edgeData.sourceVertexIndices, sourceNodePickIds),
      GPUBufferUsage.STORAGE,
    ),
    resultColorBinding: { buffer: edgeVertexBuffer, offset: edgeWithResults.offset },
  };
}

function createIndexBuffer(device: GPUDevice, indices: Uint32Array): GPUBuffer {
  return createBuffer(
    device,
    indices.length > 0 ? indices : new Uint32Array(1),
    GPUBufferUsage.INDEX,
  );
}

function createGeometryBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
  return createBuffer(device, data, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
}
