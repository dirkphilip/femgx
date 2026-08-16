import type { Geometry, Part } from "../../geometry/part";
import { buildMeshEdgeData, type MeshEdgeData } from "../edges/mesh-edge";
import { expandMeshEdgeData } from "../edges/edge-expansion";
import { buildFaceSubsetIndices } from "../selection/face-subset";
import { emptyMeshEdgeData, packTopologyData } from "./geometry-buffers";
import { buildElementPrimitiveOrdinals, buildPrimitiveFaceBodyPickData } from "../picking/ids";
import { expandSurfaceGeometry, type SurfaceVertexData } from "../resources/surface-geometry";
import {
  createBuffer,
  type PartEdgePickResource,
  type PartResource,
} from "../resources/foundation";
import { appendResultColorTail, type ResultColorTail } from "../resources/result-colors";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";

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
  geometry: Geometry,
  vertexData: UploadVertexData,
  resultTail: ResultColorTail,
): PartGeometryData {
  const triangleGeometry = geometry.primitive === "triangles" ? geometry : undefined;
  const subsetIndices = getSubsetIndices(triangleGeometry);
  const emptyEdgeData = emptyMeshEdgeData();
  const picks = uploadPickBuffers(device, part, geometry, vertexData.nodePickIds);
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(
    geometry,
    part.elements ?? [],
    part.blocks ?? [],
  );
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
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  resultTail: ResultColorTail,
): NonNullable<PartResource["edge"]> | undefined {
  const upload = buildEdgeResourceData(device, part, geometry, resultTail);
  if (upload === undefined) return undefined;
  return upload;
}

/** Builds the wider authored-edge pick geometry on first edge-granularity use. */
export function buildPartEdgePickResources(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
): PartEdgePickResource | undefined {
  const upload = buildEdgeResourceData(device, part, geometry);
  if (upload === undefined) return undefined;
  return {
    vertexBuffer: upload.edgeVertexBuffer,
    indexBuffer: upload.edgeIndexBuffer,
    nodePickIdsBuffer: upload.edgeNodePickIdsBuffer,
    topologyBuffer: upload.edgeTopologyBuffer,
    indexCount: upload.edgeIndexCount,
    edgeKeys: upload.edgeKeys ?? [],
  };
}

function buildEdgeResourceData(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  resultTail?: ResultColorTail,
) {
  const edgeData = buildMeshEdgeData(
    geometry,
    getSubsetIndices(geometry) ?? geometry.indices,
    part.elements ?? [],
    part.blocks ?? [],
  );
  if (resultTail === undefined && (edgeData.edgeKeys?.length ?? 0) === 0) return undefined;
  const expanded = expandMeshEdgeData(edgeData, geometry.nodePickIds);
  const edgeWithResults =
    resultTail === undefined ? undefined : appendResultColorTail(expanded.positions, resultTail);
  const vertexBuffer = createBuffer(
    device,
    edgeWithResults?.data ?? expanded.positions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  return {
    edgeVertexBuffer: vertexBuffer,
    edgeIndexBuffer: createIndexBuffer(device, expanded.indices),
    edgeNodePickIdsBuffer: createBuffer(device, expanded.nodePickIds, GPUBufferUsage.STORAGE),
    edgeTopologyBuffer: createTopologyBuffer(
      device,
      buildPrimitiveFaceBodyPickData(geometry, part.elements ?? [], part.blocks ?? []),
      { ...edgeData, ...expanded },
      { primitiveIds: [], edgeIds: expanded.edgeIds, blockIds: edgeData.blockIds },
    ),
    edgeIndexCount: expanded.indices.length,
    edgeKeys: edgeData.edgeKeys,
    edgeNodeIds: edgeData.edgeNodeIds,
    resultColorBinding: { buffer: vertexBuffer, offset: edgeWithResults?.offset ?? 0 },
  };
}

function uploadPickBuffers(
  device: GPUDevice,
  part: Part,
  geometry: Geometry,
  nodePickIds: Uint32Array,
): Pick<PartResource, "elementOrdinalsBuffer" | "nodePickIdsBuffer"> {
  return {
    elementOrdinalsBuffer: createBuffer(
      device,
      buildElementPrimitiveOrdinals(
        geometry,
        part.elements ?? [],
        getPartSemanticIndex(part).elementOrdinalById,
      ),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(device, nodePickIds, GPUBufferUsage.STORAGE),
  };
}

function getSubsetIndices(
  geometry: Extract<Geometry, { primitive: "triangles" }> | undefined,
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
  return part.blocks !== undefined && part.blocks.length > 0 ? new Uint32Array() : undefined;
}

function createIndexBuffer(device: GPUDevice, indices: Uint32Array): GPUBuffer {
  return createBuffer(
    device,
    indices.length > 0 ? indices : new Uint32Array(1),
    GPUBufferUsage.INDEX,
  );
}
