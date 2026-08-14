import type { Part } from "../geometry/part";
import { buildMeshEdgeData, type MeshEdgeData } from "./gpu-edge";
import { buildFaceSubsetIndices } from "./gpu-face-subset";
import { emptyMeshEdgeData, packTopologyData } from "./gpu-geometry-buffers";
import { buildElementPrimitiveOrdinals, buildPrimitiveFaceBodyPickData } from "./gpu-pick-ids";
import {
  buildEdgeNodePickIds,
  expandSurfaceGeometry,
  type SurfaceVertexData,
} from "./gpu-surface-geometry";
import { createBuffer, type PartEdgePickResource, type PartResource } from "./gpu-support";
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
  readonly picks: Pick<PartResource, "elementOrdinalsBuffer" | "nodePickIdsBuffer">;
  readonly facePickIdsBuffer: GPUBuffer;
  readonly subsetBuffers: ReturnType<typeof createSubsetBuffers>;
  readonly subsetResultColorBinding:
    { readonly buffer: GPUBuffer; readonly offset: number } | undefined;
  readonly subsetIndices: Uint32Array | undefined;
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
  const emptyEdgeData = emptyMeshEdgeData();
  const picks = uploadPickBuffers(device, part, vertexData.nodePickIds);
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(part.geometry);
  const facePickIdsBuffer = createTopologyBuffer(device, faceBodyPickIds, emptyEdgeData, {
    primitiveIds: vertexData.primitiveIds,
    edgeIds: emptyEdgeData.edgeIds,
    blockIds: blockAwareIds(part),
  });
  const subsetVertexData =
    triangleGeometry === undefined || subsetIndices === undefined
      ? undefined
      : expandSurfaceGeometry(triangleGeometry, subsetIndices);
  const { subsetResultColorBinding, ...subsetBuffers } = createSubsetBuffers(
    device,
    subsetVertexData,
    faceBodyPickIds,
    resultTail,
    blockAwareIds(part),
  );
  return {
    picks,
    facePickIdsBuffer,
    subsetBuffers,
    subsetResultColorBinding,
    subsetIndices,
  };
}

/** Builds the optional retained edge resource for a triangle part. */
export function buildPartEdgeResources(
  device: GPUDevice,
  part: Part,
  resultTail: ResultColorTail,
): NonNullable<PartResource["edge"]> | undefined {
  if (part.geometry.primitive !== "triangles") return undefined;
  const subsetIndices = getSubsetIndices(part.geometry);
  const edgeData = buildMeshEdgeData(part.geometry, subsetIndices ?? part.geometry.indices);
  const edgeWithResults = appendResultColorTail(edgeData.positions, resultTail);
  const edgeVertexBuffer = createBuffer(
    device,
    edgeWithResults.data,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  return {
    edgeVertexBuffer,
    edgeIndexBuffer: createIndexBuffer(device, edgeData.indices),
    edgeNodePickIdsBuffer: createBuffer(
      device,
      buildEdgeNodePickIds(edgeData.sourceVertexIndices, part.geometry.nodePickIds),
      GPUBufferUsage.STORAGE,
    ),
    edgeTopologyBuffer: createTopologyBuffer(
      device,
      buildPrimitiveFaceBodyPickData(part.geometry),
      edgeData,
      { primitiveIds: [], edgeIds: edgeData.edgeIds, blockIds: edgeData.blockIds },
    ),
    edgeIndexCount: edgeData.indices.length,
    edgeKeys: edgeData.edgeKeys,
    edgeNodeIds: edgeData.edgeNodeIds,
    resultColorBinding: { buffer: edgeVertexBuffer, offset: edgeWithResults.offset },
  };
}

/** Builds the wider authored-edge pick geometry on first edge-granularity use. */
export function buildPartEdgePickResources(
  device: GPUDevice,
  part: Part,
): PartEdgePickResource | undefined {
  if (part.geometry.primitive !== "triangles") return undefined;
  const subsetIndices = getSubsetIndices(part.geometry);
  const edgeData = buildMeshEdgeData(part.geometry, subsetIndices ?? part.geometry.indices);
  if (edgeData.edgeKeys === undefined || edgeData.edgeKeys.length === 0) return undefined;
  const segments = Math.floor(edgeData.indices.length / 2);
  const positions = new Float32Array(segments * 4 * 3);
  const nodePickIds = new Uint32Array(segments * 4);
  const indices = new Uint32Array(segments * 6);
  const edgeIds = new Uint32Array(segments * 4);
  for (let segment = 0; segment < segments; segment += 1) {
    const source = segment * 2;
    const vertex = segment * 4;
    positions.set(edgeData.positions.subarray(source * 3, source * 3 + 3), vertex * 3);
    positions.set(
      edgeData.positions.subarray((source + 1) * 3, (source + 2) * 3),
      (vertex + 1) * 3,
    );
    positions.set(
      edgeData.positions.subarray((source + 1) * 3, (source + 2) * 3),
      (vertex + 2) * 3,
    );
    positions.set(edgeData.positions.subarray(source * 3, source * 3 + 3), (vertex + 3) * 3);
    const nodeA = part.geometry.nodePickIds?.[edgeData.sourceVertexIndices[source] ?? 0] ?? 0;
    const nodeB = part.geometry.nodePickIds?.[edgeData.sourceVertexIndices[source + 1] ?? 0] ?? 0;
    nodePickIds.set([nodeA, nodeB, nodeB, nodeA], vertex);
    const edgeId = edgeData.edgeIds[source] ?? 0;
    edgeIds.fill(edgeId, vertex, vertex + 4);
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], segment * 6);
  }
  const topology = { ...edgeData, edgeIds };
  return {
    vertexBuffer: createBuffer(device, positions, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE),
    indexBuffer: createBuffer(device, indices, GPUBufferUsage.INDEX),
    nodePickIdsBuffer: createBuffer(device, nodePickIds, GPUBufferUsage.STORAGE),
    topologyBuffer: createTopologyBuffer(
      device,
      buildPrimitiveFaceBodyPickData(part.geometry),
      topology,
      { primitiveIds: [], edgeIds, blockIds: edgeData.blockIds },
    ),
    indexCount: indices.length,
    edgeKeys: edgeData.edgeKeys,
  };
}

function uploadPickBuffers(
  device: GPUDevice,
  part: Part,
  nodePickIds: Uint32Array,
): Pick<PartResource, "elementOrdinalsBuffer" | "nodePickIdsBuffer"> {
  return {
    elementOrdinalsBuffer: createBuffer(
      device,
      buildElementPrimitiveOrdinals(part.geometry),
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

function createTopologyBuffer(
  device: GPUDevice,
  faceBodyPickIds: Uint32Array,
  edgeData: MeshEdgeData,
  metadata: {
    readonly primitiveIds: ArrayLike<number>;
    readonly edgeIds: ArrayLike<number>;
    readonly blockIds?: Uint32Array | undefined;
  },
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
  faceBodyPickIds: Uint32Array,
  resultTail: ResultColorTail,
  blockIds?: Uint32Array,
): {
  readonly subsetIndexBuffer?: GPUBuffer;
  readonly subsetVertexBuffer?: GPUBuffer;
  readonly subsetNodePickIdsBuffer?: GPUBuffer;
  readonly subsetTopologyBuffer?: GPUBuffer;
  readonly subsetResultColorBinding?: { readonly buffer: GPUBuffer; readonly offset: number };
} {
  if (vertexData === undefined) return {};
  const subsetVertexWithResults = appendResultColorTail(vertexData.positions, resultTail);
  const subsetVertexBuffer = createBuffer(
    device,
    subsetVertexWithResults.data,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  return {
    subsetIndexBuffer: createIndexBuffer(device, vertexData.indices),
    subsetVertexBuffer,
    subsetNodePickIdsBuffer: createBuffer(device, vertexData.nodePickIds, GPUBufferUsage.STORAGE),
    subsetTopologyBuffer: createTopologyBuffer(device, faceBodyPickIds, emptyMeshEdgeData(), {
      primitiveIds: vertexData.primitiveIds,
      edgeIds: [],
      blockIds,
    }),
    subsetResultColorBinding: {
      buffer: subsetVertexBuffer,
      offset: subsetVertexWithResults.offset,
    },
  };
}

function blockAwareIds(part: Part): Uint32Array | undefined {
  return part.geometry.blocks !== undefined && part.geometry.blocks.length > 0
    ? new Uint32Array()
    : undefined;
}

function createIndexBuffer(device: GPUDevice, indices: Uint32Array): GPUBuffer {
  return createBuffer(
    device,
    indices.length > 0 ? indices : new Uint32Array(1),
    GPUBufferUsage.INDEX,
  );
}
