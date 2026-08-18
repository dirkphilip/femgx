import type { Geometry, Part } from "../../geometry/part";
import {
  buildMeshEdgeData,
  buildUnownedMeshEdgePresentation,
  type MeshEdgePresentationBuild,
  type MeshEdgeData,
} from "../edges/mesh-edge";
import {
  expandMeshEdgeData,
  meshEdgeEndpointData,
  type MeshEdgeDrawData,
} from "../edges/edge-expansion";
import { buildFaceSubsetIndices } from "../selection/face-subset";
import {
  emptyMeshEdgeData,
  packTopologyData,
  packUnownedEdgeTopologyData,
} from "./geometry-buffers";
import { buildElementPrimitiveOrdinals, buildPrimitiveFaceBodyPickData } from "../picking/ids";
import { expandSurfaceGeometry, type SurfaceVertexData } from "../resources/surface-geometry";
import {
  createBuffer,
  type PartEdgePickResource,
  type PartResource,
} from "../resources/foundation";
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
  readonly nodePickIdsBuffer: GPUBuffer;
  readonly facePickIdsBuffer: GPUBuffer;
  readonly subsetBuffers: ReturnType<typeof createSubsetBuffers>;
  readonly subsetIndices: Uint32Array | undefined;
}

export interface PartSubsetGeometryData {
  readonly subsetBuffers: ReturnType<typeof createSubsetBuffers>;
  readonly subsetIndices: Uint32Array;
}

interface FullGeometryBuffers {
  readonly nodePickIdsBuffer: GPUBuffer;
  readonly facePickIdsBuffer: GPUBuffer;
}

/** Builds all non-position buffers and appended result-color bindings for a part. */
export function buildPartGeometryData(
  device: GPUDevice,
  part: Part,
  geometry: Geometry,
  vertexData: UploadVertexData,
): PartGeometryData {
  const triangleGeometry = geometry.primitive === "triangles" ? geometry : undefined;
  const subsetIndices = getSubsetIndices(triangleGeometry);
  const elementOrdinals = buildElementPrimitiveOrdinals(
    geometry,
    part.elements ?? [],
    getPartSemanticIndex(part).elementOrdinalById,
  );
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(geometry, part.elements ?? []);
  const fullBuffers = buildFullGeometryBuffers(
    device,
    vertexData,
    faceBodyPickIds,
    elementOrdinals,
  );
  const subsetVertexData =
    triangleGeometry === undefined || subsetIndices === undefined
      ? undefined
      : expandSurfaceGeometry(triangleGeometry, subsetIndices);
  const subsetBuffers = createSubsetBuffers(
    device,
    subsetVertexData,
    faceBodyPickIds,
    elementOrdinals,
  );
  return {
    ...fullBuffers,
    subsetBuffers,
    subsetIndices,
  };
}

/** Builds only the exterior geometry and metadata needed by a subset-first draw. */
export function buildPartSubsetGeometryData(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
): PartSubsetGeometryData | undefined {
  const subsetIndices = getSubsetIndices(geometry);
  if (subsetIndices === undefined || subsetIndices.length === 0) return undefined;
  const elementOrdinals = buildElementPrimitiveOrdinals(
    geometry,
    part.elements ?? [],
    getPartSemanticIndex(part).elementOrdinalById,
  );
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(geometry, part.elements ?? []);
  const subsetVertexData = expandSurfaceGeometry(geometry, subsetIndices);
  return {
    subsetBuffers: createSubsetBuffers(device, subsetVertexData, faceBodyPickIds, elementOrdinals),
    subsetIndices,
  };
}

/** Materializes the full interior buffers after a subset-first upload. */
export function materializeFullGeometry(
  device: GPUDevice,
  part: Part,
  geometry: Exclude<Geometry, Extract<Geometry, { primitive: "points" }>>,
  resource: PartResource,
): void {
  if (resource.fullVertexBuffer !== undefined) return;
  const vertexData = expandSurfaceGeometry(geometry);
  const elementOrdinals = buildElementPrimitiveOrdinals(
    geometry,
    part.elements ?? [],
    getPartSemanticIndex(part).elementOrdinalById,
  );
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(geometry, part.elements ?? []);
  const fullBuffers = buildFullGeometryBuffers(
    device,
    vertexData,
    faceBodyPickIds,
    elementOrdinals,
  );
  resource.fullVertexBuffer = createBuffer(
    device,
    vertexData.positions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  resource.fullIndexBuffer = createIndexBuffer(device, vertexData.indices);
  resource.fullFacePickIdsBuffer = fullBuffers.facePickIdsBuffer;
  resource.fullNodePickIdsBuffer = fullBuffers.nodePickIdsBuffer;
  resource.fullIndexCount = vertexData.indices.length;
}

function buildFullGeometryBuffers(
  device: GPUDevice,
  vertexData: UploadVertexData,
  faceBodyPickIds: Uint32Array,
  elementOrdinals: Uint32Array,
): FullGeometryBuffers {
  const emptyEdgeData = emptyMeshEdgeData();
  return {
    nodePickIdsBuffer: createBuffer(device, vertexData.nodePickIds, GPUBufferUsage.STORAGE),
    facePickIdsBuffer: createTopologyBuffer(device, faceBodyPickIds, emptyEdgeData, {
      elementOrdinals,
      primitiveIds: vertexData.primitiveIds,
      edgeIds: emptyEdgeData.edgeIds,
    }),
  };
}

/** Builds the optional retained edge resource for a triangle part. */
export function buildPartEdgeResources(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
): NonNullable<PartResource["edge"]> | undefined {
  const edgeBuild = buildPartMeshEdgeData(part, geometry, true);
  const edgeData = edgeBuild.edgeData;
  return uploadEdgeResourceData(device, part, geometry, {
    edgeData,
    drawData: meshEdgeEndpointData(edgeData, geometry.nodePickIds),
    ...(edgeBuild.primitiveElementPickIds === undefined
      ? {}
      : { primitiveElementPickIds: edgeBuild.primitiveElementPickIds }),
  });
}

/** Builds the wider authored-edge pick geometry on first edge-granularity use. */
export function buildPartEdgePickResources(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
): PartEdgePickResource | undefined {
  const edgeData = buildPartMeshEdgeData(part, geometry, false).edgeData;
  if ((edgeData.edgeKeys?.length ?? 0) === 0) return undefined;
  const upload = uploadEdgeResourceData(device, part, geometry, {
    edgeData,
    drawData: expandMeshEdgeData(edgeData, geometry.nodePickIds),
  });
  return {
    vertexBuffer: upload.edgeVertexBuffer,
    indexBuffer: upload.edgeIndexBuffer,
    nodePickIdsBuffer: upload.edgeNodePickIdsBuffer,
    topologyBuffer: upload.edgeTopologyBuffer,
    indexCount: upload.edgeIndexCount,
    edgeKeys: upload.edgeKeys ?? [],
  };
}

function buildPartMeshEdgeData(
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  presentationOnly: boolean,
): MeshEdgePresentationBuild {
  const indices = getSubsetIndices(geometry) ?? geometry.indices;
  const elements = part.elements ?? [];
  if (presentationOnly && (part.bodies?.length ?? 0) === 0) {
    return buildUnownedMeshEdgePresentation(geometry, indices, elements);
  }
  return { edgeData: buildMeshEdgeData(geometry, indices, elements) };
}

interface EdgeUploadOptions {
  readonly edgeData: MeshEdgeData;
  readonly drawData: MeshEdgeDrawData;
  readonly primitiveElementPickIds?: Uint32Array;
}

function uploadEdgeResourceData(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  options: EdgeUploadOptions,
) {
  const { edgeData, drawData } = options;
  const vertexBuffer = createBuffer(
    device,
    drawData.positions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  const elementOrdinals = buildElementPrimitiveOrdinals(
    geometry,
    part.elements ?? [],
    getPartSemanticIndex(part).elementOrdinalById,
  );
  return {
    edgeVertexBuffer: vertexBuffer,
    edgeIndexBuffer: createIndexBuffer(device, drawData.indices),
    edgeNodePickIdsBuffer: createBuffer(device, drawData.nodePickIds, GPUBufferUsage.STORAGE),
    edgeTopologyBuffer: createBuffer(
      device,
      options.primitiveElementPickIds === undefined
        ? packTopologyData(
            buildPrimitiveFaceBodyPickData(geometry, part.elements ?? []),
            edgeData.bodyRanges,
            edgeData.bodyIds,
            edgeData.elementIds,
            { elementOrdinals, primitiveIds: [], edgeIds: drawData.edgeIds },
          )
        : packUnownedEdgeTopologyData(
            edgeData,
            elementOrdinals,
            options.primitiveElementPickIds,
            drawData.edgeIds,
          ),
      GPUBufferUsage.STORAGE,
    ),
    edgeIndexCount: drawData.indices.length,
    edgeKeys: edgeData.edgeKeys,
    edgeNodeIds: edgeData.edgeNodeIds,
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
    readonly elementOrdinals: ArrayLike<number>;
    readonly primitiveIds: ArrayLike<number>;
    readonly edgeIds: ArrayLike<number>;
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
  elementOrdinals: Uint32Array,
): {
  readonly subsetIndexBuffer?: GPUBuffer;
  readonly subsetVertexBuffer?: GPUBuffer;
  readonly subsetNodePickIdsBuffer?: GPUBuffer;
  readonly subsetTopologyBuffer?: GPUBuffer;
} {
  if (vertexData === undefined) return {};
  const subsetVertexBuffer = createBuffer(
    device,
    vertexData.positions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  return {
    subsetIndexBuffer: createIndexBuffer(device, vertexData.indices),
    subsetVertexBuffer,
    subsetNodePickIdsBuffer: createBuffer(device, vertexData.nodePickIds, GPUBufferUsage.STORAGE),
    subsetTopologyBuffer: createTopologyBuffer(device, faceBodyPickIds, emptyMeshEdgeData(), {
      elementOrdinals,
      primitiveIds: vertexData.primitiveIds,
      edgeIds: [],
    }),
  };
}

function createIndexBuffer(device: GPUDevice, indices: Uint32Array): GPUBuffer {
  return createBuffer(
    device,
    indices.length > 0 ? indices : new Uint32Array(1),
    GPUBufferUsage.INDEX,
  );
}
