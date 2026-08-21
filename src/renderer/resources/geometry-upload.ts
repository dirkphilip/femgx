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
  conditionElementOrdinals,
  emptyMeshEdgeData,
  neighborElementOrdinals,
  packTopologyData,
  packUnownedEdgeTopologyData,
} from "./geometry-buffers";
import { createTopologyBuffer } from "../picking/topology-buffer";
import { createSubsetBuffers } from "../selection/subset-buffers";
import { buildElementPrimitiveOrdinals, buildPrimitiveFaceBodyPickData } from "../picking/ids";
import { expandSurfaceGeometry } from "../resources/surface-geometry";
import {
  triangleSubsetUploadData,
  triangleUploadData,
  type UploadVertexData,
} from "./triangle-upload";
import {
  createBuffer,
  type PartEdgePickResource,
  type PartResource,
} from "../resources/foundation";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";

export {
  triangleSubsetUploadData,
  triangleUploadData,
  type UploadVertexData,
} from "./triangle-upload";

/** Geometry buffers and metadata assembled for one cached part resource. */
export interface PartGeometryData {
  readonly nodePickIdsBuffer: GPUBuffer;
  readonly facePickIdsBuffer: GPUBuffer;
  readonly cornerIndexOffset?: number;
  readonly subsetBuffers: ReturnType<typeof createSubsetBuffers>;
  readonly subsetIndices: Uint32Array | undefined;
}

function elementsForPart(part: Part) {
  return part.elements;
}

export interface PartSubsetGeometryData {
  readonly subsetBuffers: ReturnType<typeof createSubsetBuffers>;
  readonly subsetIndices: Uint32Array;
}

interface FullGeometryBuffers {
  readonly nodePickIdsBuffer: GPUBuffer;
  readonly facePickIdsBuffer: GPUBuffer;
  readonly cornerIndexOffset?: number;
}

/** Resolves source-primitive ownership columns used by GPU topology buffers. */
export function partTopologyData(
  part: Part,
  geometry: Geometry,
  includeNeighborOrdinals = false,
): {
  readonly elementOrdinals: Uint32Array;
  readonly neighborElementOrdinals?: Uint32Array;
  readonly faceBodyPickIds: Uint32Array;
} {
  const elements = elementsForPart(part) ?? [];
  const metadata = getPartSemanticIndex(part);
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(geometry, elements);
  return {
    elementOrdinals: buildElementPrimitiveOrdinals(geometry, elements, (elementId) =>
      metadata.elementOrdinal(elementId),
    ),
    ...(includeNeighborOrdinals
      ? {
          neighborElementOrdinals: neighborElementOrdinals(faceBodyPickIds, (elementId) =>
            metadata.elementOrdinal(elementId),
          ),
        }
      : {}),
    faceBodyPickIds,
  };
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
  const { elementOrdinals, neighborElementOrdinals, faceBodyPickIds } = partTopologyData(
    part,
    geometry,
    true,
  );
  const fullBuffers = buildFullGeometryBuffers(
    device,
    vertexData,
    faceBodyPickIds,
    elementOrdinals,
    neighborElementOrdinals ?? new Uint32Array(),
  );
  try {
    const subsetVertexData =
      triangleGeometry === undefined || subsetIndices === undefined
        ? undefined
        : triangleSubsetUploadData(triangleGeometry, subsetIndices);
    const subsetBuffers = createSubsetBuffers(
      device,
      subsetVertexData,
      faceBodyPickIds,
      elementOrdinals,
    );
    return { ...fullBuffers, subsetBuffers, subsetIndices };
  } catch (error) {
    destroyFullGeometryBuffers(fullBuffers);
    throw error;
  }
}

/** Uploads imported per-triangle display colors in the result-color layout. */
export function createPrimitiveColorBuffer(
  device: GPUDevice,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
): GPUBuffer | undefined {
  const colors = geometry.primitiveColors;
  if (colors === undefined) return undefined;
  const primitiveCount = geometry.indices.length / 3;
  const data = new Float32Array((primitiveCount + 1) * 4);
  data[0] = 1;
  data[1] = primitiveCount + 1;
  data.set(colors, 4);
  return createBuffer(device, data, GPUBufferUsage.STORAGE, "femgx primitive display colors");
}

/** Builds only the exterior geometry and metadata needed by a subset-first draw. */
export function buildPartSubsetGeometryData(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
): PartSubsetGeometryData | undefined {
  const subsetIndices = getSubsetIndices(geometry);
  if (subsetIndices === undefined || subsetIndices.length === 0) return undefined;
  const { elementOrdinals, faceBodyPickIds } = partTopologyData(part, geometry);
  const subsetVertexData = triangleSubsetUploadData(geometry, subsetIndices);
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
  const vertexData =
    geometry.primitive === "triangles"
      ? triangleUploadData(geometry)
      : expandSurfaceGeometry(geometry);
  const { elementOrdinals, neighborElementOrdinals, faceBodyPickIds } = partTopologyData(
    part,
    geometry,
    true,
  );
  const fullBuffers = buildFullGeometryBuffers(
    device,
    vertexData,
    faceBodyPickIds,
    elementOrdinals,
    neighborElementOrdinals ?? new Uint32Array(),
  );
  const allocated = [fullBuffers.nodePickIdsBuffer, fullBuffers.facePickIdsBuffer];
  try {
    const fullVertexBuffer = trackBuffer(
      allocated,
      createBuffer(device, vertexData.positions, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE),
    );
    const fullIndexBuffer = trackBuffer(allocated, createIndexBuffer(device, vertexData.indices));
    resource.fullVertexBuffer = fullVertexBuffer;
    resource.fullIndexBuffer = fullIndexBuffer;
    if (fullBuffers.cornerIndexOffset !== undefined) {
      resource.fullMinimalIndexBuffer = fullBuffers.facePickIdsBuffer;
      resource.fullMinimalIndexOffset = fullBuffers.cornerIndexOffset;
    }
    resource.fullFacePickIdsBuffer = fullBuffers.facePickIdsBuffer;
    resource.fullNodePickIdsBuffer = fullBuffers.nodePickIdsBuffer;
    resource.fullIndexCount = vertexData.indices.length;
  } catch (error) {
    destroyBuffers(allocated);
    throw error;
  }
}

function buildFullGeometryBuffers(
  device: GPUDevice,
  vertexData: UploadVertexData,
  faceBodyPickIds: Uint32Array,
  elementOrdinals: Uint32Array,
  neighborElementOrdinals: Uint32Array,
): FullGeometryBuffers {
  const emptyEdgeData = emptyMeshEdgeData();
  const nodePickIdsBuffer = createBuffer(device, vertexData.nodePickIds, GPUBufferUsage.STORAGE);
  try {
    const topology = createTopologyBuffer(device, faceBodyPickIds, emptyEdgeData, {
      elementOrdinals,
      neighborElementOrdinals,
      primitiveIds: vertexData.primitiveIds,
      edgeIds: emptyEdgeData.edgeIds,
      ...(vertexData.cornerIndices === undefined
        ? {}
        : { cornerIndices: vertexData.cornerIndices }),
    });
    return {
      nodePickIdsBuffer,
      facePickIdsBuffer: topology.buffer,
      ...(topology.cornerIndexOffset === undefined
        ? {}
        : { cornerIndexOffset: topology.cornerIndexOffset }),
    };
  } catch (error) {
    nodePickIdsBuffer.destroy();
    throw error;
  }
}

function destroyFullGeometryBuffers(buffers: FullGeometryBuffers): void {
  destroyBuffers([buffers.nodePickIdsBuffer, buffers.facePickIdsBuffer]);
}

function trackBuffer(buffers: GPUBuffer[], buffer: GPUBuffer): GPUBuffer {
  buffers.push(buffer);
  return buffer;
}

function destroyBuffers(buffers: readonly GPUBuffer[]): void {
  for (const buffer of new Set(buffers)) buffer.destroy();
}

/** Builds the optional retained edge resource for a triangle part. */
export function buildPartEdgeResources(
  device: GPUDevice,
  part: Part,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  fullTopology = false,
): NonNullable<PartResource["edge"]> | undefined {
  const edgeBuild = buildPartMeshEdgeData(part, geometry, true, fullTopology);
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
  fullTopology = false,
): PartEdgePickResource | undefined {
  const edgeData = buildPartMeshEdgeData(part, geometry, false, fullTopology).edgeData;
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
  fullTopology: boolean,
): MeshEdgePresentationBuild {
  const indices = fullTopology
    ? geometry.indices
    : (getSubsetIndices(geometry) ?? geometry.indices);
  const elements = elementsForPart(part) ?? [];
  if (presentationOnly && (part.bodies?.count ?? 0) === 0) {
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
    elementsForPart(part) ?? [],
    (elementId) => getPartSemanticIndex(part).elementOrdinal(elementId),
  );
  const metadata = getPartSemanticIndex(part);
  const edgeConditionElementOrdinals = conditionElementOrdinals(edgeData.elementIds, (elementId) =>
    metadata.elementOrdinal(elementId - 1),
  );
  return {
    edgeVertexBuffer: vertexBuffer,
    edgeIndexBuffer: createIndexBuffer(device, drawData.indices),
    edgeNodePickIdsBuffer: createBuffer(device, drawData.nodePickIds, GPUBufferUsage.STORAGE),
    edgeTopologyBuffer: createBuffer(
      device,
      options.primitiveElementPickIds === undefined
        ? packTopologyData(
            buildPrimitiveFaceBodyPickData(geometry, elementsForPart(part) ?? []),
            edgeData.bodyRanges,
            edgeData.bodyIds,
            edgeData.elementIds,
            {
              elementOrdinals,
              conditionElementOrdinals: edgeConditionElementOrdinals,
              primitiveIds: [],
              edgeIds: drawData.edgeIds,
            },
          )
        : packUnownedEdgeTopologyData(
            edgeData,
            elementOrdinals,
            options.primitiveElementPickIds,
            drawData.edgeIds,
            (elementPickId) => metadata.elementOrdinal(elementPickId - 1) ?? 0,
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

function createIndexBuffer(device: GPUDevice, indices: Uint32Array): GPUBuffer {
  return createBuffer(
    device,
    indices.length > 0 ? indices : new Uint32Array(1),
    GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE,
  );
}
