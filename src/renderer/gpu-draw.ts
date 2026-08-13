import type { Part } from "../geometry/part";
import type { PartId } from "../geometry/part";
import { destroyDeformationBuffers, type DeformationStorage } from "./gpu-deform";
import { buildMeshEdgeData, type MeshEdgeData } from "./gpu-edge";
import { buildFaceSubsetIndices } from "./gpu-face-subset";
import {
  createGeometryDataBuffer,
  emptyMeshEdgeData,
  packTopologyData,
} from "./gpu-geometry-buffers";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  buildElementPrimitivePickIds,
  buildNodeBodyPickData,
  buildNodeBodyOwnerData,
  buildNodeSpritePickIds,
  buildPrimitiveFaceBodyPickData,
} from "./gpu-pick-ids";
import type { DrawPipelines } from "./gpu-pipelines";
import {
  buildEdgeNodePickIds,
  expandSurfaceGeometry,
  type SurfaceVertexData,
} from "./gpu-surface-geometry";
import { createBuffer, type PartResource } from "./gpu-support";
import { createColorTargets, destroyColorTargets, type ColorTargets } from "./gpu-targets";

const POINT_SPRITE_INDICES = [0, 1, 2, 0, 2, 3] as const;

export {
  INSTANCE_STRIDE,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  patchInstances,
  writeDrawOrder,
  writeTransparentOrder,
  writeSelectionOrder,
  writeNodeSelectionOrder,
  writeEdgeOrder,
  writeNodeOrder,
  type InstanceStorage,
  type InstanceUpdate,
} from "./gpu-instance-storage";

/** A single instanced draw for one part. */
export interface DrawCall {
  readonly partId: PartId;
  readonly instanceCount: number;
}

/** Per-part geometry and instance storage buffers owned by the draw path. */
export interface DrawResources {
  readonly device: GPUDevice;
  readonly parts: Map<PartId, PartResource>;
  readonly nodeParts: Map<PartId, PartResource>;
  readonly storages: Map<PartId, InstanceStorage>;
  readonly deformations: Map<PartId, DeformationStorage>;
  /** The complete visible-frame target state and its composite cache. */
  readonly targets: ColorTargets;
}

/** Per-frame inputs shared by every draw batch of a pass. */
export interface DrawCallContext {
  readonly frameBindGroup: GPUBindGroup;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly pipelines: DrawPipelines;
}

/** Creates the draw-path resource owner. */
export function createDrawResources(device: GPUDevice): DrawResources {
  return {
    device,
    parts: new Map(),
    nodeParts: new Map(),
    storages: new Map(),
    deformations: new Map(),
    targets: createColorTargets(),
  };
}

/** Uploads the transient node-sprite geometry and its body-owner metadata. */
export function uploadNodePart(draw: DrawResources, part: Part): PartResource {
  const existing = draw.nodeParts.get(part.id);
  if (existing !== undefined) return existing;
  const nodes = part.geometry.nodePositions ?? new Float32Array(0);
  const spritePickIds = buildNodeSpritePickIds(part.geometry);
  const nodeBodyData = buildNodeBodyOwnerData(part.geometry, spritePickIds);
  const count = spritePickIds.length;
  const positions = new Float32Array(count * 12);
  const ids = new Uint32Array(count * 4);
  const indices = new Uint32Array(count * 6);
  for (let sprite = 0; sprite < count; sprite += 1) {
    const pickId = spritePickIds[sprite] ?? 0;
    const source = (pickId - 1) * 3;
    for (let corner = 0; corner < 4; corner += 1) {
      positions.set(nodes.subarray(source, source + 3), (sprite * 4 + corner) * 3);
      ids[sprite * 4 + corner] = pickId;
    }
    writePointSpriteIndices(indices, sprite);
  }
  const resource: PartResource = {
    vertexBuffer: createBuffer(
      draw.device,
      positions,
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
    ),
    indexBuffer: createBuffer(draw.device, indices, GPUBufferUsage.INDEX),
    // The node overlay reuses the point vertex shader. It indexes this map by
    // node sprite, so provide one explicit zero entry per sprite instead of a
    // single placeholder that would be out of bounds for larger models.
    elementPickIdsBuffer: createBuffer(draw.device, new Uint32Array(count), GPUBufferUsage.STORAGE),
    facePickIdsBuffer: createBuffer(
      draw.device,
      packTopologyData(
        buildNodeBodyPickData(part.geometry, spritePickIds),
        nodeBodyData.bodyRanges,
        nodeBodyData.bodyIds,
        nodeBodyData.elementIds,
      ),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(draw.device, ids, GPUBufferUsage.STORAGE),
    edgeNodePickIdsBuffer: createBuffer(draw.device, ids, GPUBufferUsage.STORAGE),
    geometryDataBuffer: createGeometryDataBuffer(
      draw.device,
      positions,
      Uint32Array.from({ length: count * 4 }, (_, vertex) => Math.floor(vertex / 4)),
      emptyMeshEdgeData(),
    ),
    edgeVertexBuffer: createBuffer(draw.device, new Float32Array(3), GPUBufferUsage.VERTEX),
    edgeIndexBuffer: createBuffer(draw.device, new Uint32Array(1), GPUBufferUsage.INDEX),
    indexCount: indices.length,
    edgeIndexCount: 0,
    subsetIndexCount: 0,
    subsetEdgeIndexCount: 0,
  };
  draw.nodeParts.set(part.id, resource);
  return resource;
}

/**
 * Returns the cached geometry buffers for a part, uploading them once. Only
 * triangle parts carry a deduplicated edge list, so the edge overlay never
 * draws spurious edges for line or point primitives.
 */
export function uploadPart(draw: DrawResources, part: Part): PartResource {
  const existing = draw.parts.get(part.id);
  if (existing !== undefined) return existing;
  const vertexData: SurfaceVertexData | PointVertexData =
    part.geometry.primitive === "points"
      ? expandPointGeometry(part.geometry)
      : expandSurfaceGeometry(part.geometry);
  const vertexBuffer = createBuffer(
    draw.device,
    vertexData.positions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  const indexBuffer = createBuffer(draw.device, vertexData.indices, GPUBufferUsage.INDEX);
  const triangleGeometry = part.geometry.primitive === "triangles" ? part.geometry : undefined;
  const subsetIndices =
    triangleGeometry?.faceSubset === undefined
      ? undefined
      : buildFaceSubsetIndices(triangleGeometry);
  const edgeData = triangleGeometry
    ? buildMeshEdgeData(triangleGeometry, subsetIndices ?? triangleGeometry.indices)
    : emptyMeshEdgeData();
  const picks = uploadPickBuffers(draw, part, vertexData.nodePickIds);
  const faceBodyPickIds = buildPrimitiveFaceBodyPickData(part.geometry);
  const geometryDataBuffer = createGeometryDataBuffer(
    draw.device,
    vertexData.positions,
    vertexData.primitiveIds,
    edgeData,
  );
  const facePickIdsBuffer = createBuffer(
    draw.device,
    packTopologyData(faceBodyPickIds, edgeData.bodyRanges, edgeData.bodyIds, edgeData.elementIds),
    GPUBufferUsage.STORAGE,
  );
  const edgeBuffers = createEdgeBuffers(draw.device, edgeData, part.geometry.nodePickIds);
  const subsetVertexData =
    triangleGeometry === undefined || subsetIndices === undefined
      ? undefined
      : expandSurfaceGeometry(triangleGeometry, subsetIndices);
  const subsetBuffers = createSubsetBuffers(draw.device, subsetVertexData, edgeData);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    ...picks,
    facePickIdsBuffer,
    geometryDataBuffer,
    ...edgeBuffers,
    indexCount: vertexData.indices.length,
    edgeIndexCount: edgeData.indices.length,
    ...subsetBuffers,
    subsetIndexCount: subsetIndices?.length ?? 0,
    subsetEdgeIndexCount: triangleGeometry?.faceSubset === undefined ? 0 : edgeData.indices.length,
  };
  draw.parts.set(part.id, resource);
  return resource;
}

function uploadPickBuffers(
  draw: DrawResources,
  part: Part,
  nodePickIds: Uint32Array,
): Pick<PartResource, "elementPickIdsBuffer" | "nodePickIdsBuffer"> {
  return {
    elementPickIdsBuffer: createBuffer(
      draw.device,
      buildElementPrimitivePickIds(part.geometry),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(draw.device, nodePickIds, GPUBufferUsage.STORAGE),
  };
}

interface PointVertexData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
  readonly primitiveIds: Uint32Array;
}

/** Expands logical point centers into the camera-facing sprite vertices. */
function expandPointGeometry(
  geometry: Extract<Part["geometry"], { primitive: "points" }>,
): PointVertexData {
  const pointCount = geometry.indices.length;
  const positions = new Float32Array(pointCount * 12);
  const indices = new Uint32Array(pointCount * 6);
  const nodePickIds = new Uint32Array(pointCount * 4);
  const primitiveIds = new Uint32Array(pointCount * 4);
  for (let point = 0; point < pointCount; point += 1) {
    const sourceIndex = geometry.indices[point] ?? 0;
    const sourceOffset = sourceIndex * 3;
    const targetOffset = point * 12;
    const x = geometry.positions[sourceOffset] ?? 0;
    const y = geometry.positions[sourceOffset + 1] ?? 0;
    const z = geometry.positions[sourceOffset + 2] ?? 0;
    for (let corner = 0; corner < 4; corner += 1) {
      const offset = targetOffset + corner * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      nodePickIds[point * 4 + corner] = geometry.nodePickIds?.[sourceIndex] ?? 0;
      primitiveIds[point * 4 + corner] = point;
    }
    writePointSpriteIndices(indices, point);
  }
  return { positions, indices, nodePickIds, primitiveIds };
}

function writePointSpriteIndices(indices: Uint32Array, sprite: number): void {
  indices.set(
    POINT_SPRITE_INDICES.map((index) => index + sprite * 4),
    sprite * POINT_SPRITE_INDICES.length,
  );
}

function createIndexBuffer(device: GPUDevice, indices: Uint32Array): GPUBuffer {
  return createBuffer(
    device,
    indices.length > 0 ? indices : new Uint32Array(1),
    GPUBufferUsage.INDEX,
  );
}

function createSubsetBuffers(
  device: GPUDevice,
  vertexData: SurfaceVertexData | undefined,
  edgeData: MeshEdgeData,
): Pick<
  PartResource,
  | "subsetIndexBuffer"
  | "subsetVertexBuffer"
  | "subsetNodePickIdsBuffer"
  | "subsetGeometryDataBuffer"
  | "subsetEdgeVertexBuffer"
  | "subsetEdgeIndexBuffer"
> {
  if (vertexData === undefined) return {};
  return {
    subsetIndexBuffer: createIndexBuffer(device, vertexData.indices),
    subsetVertexBuffer: createBuffer(
      device,
      vertexData.positions,
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
    ),
    subsetNodePickIdsBuffer: createBuffer(device, vertexData.nodePickIds, GPUBufferUsage.STORAGE),
    subsetGeometryDataBuffer: createGeometryDataBuffer(
      device,
      vertexData.positions,
      vertexData.primitiveIds,
      emptyMeshEdgeData(),
    ),
    subsetEdgeVertexBuffer: createBuffer(device, edgeData.positions, GPUBufferUsage.VERTEX),
    subsetEdgeIndexBuffer: createIndexBuffer(device, edgeData.indices),
  };
}

function createEdgeBuffers(
  device: GPUDevice,
  edgeData: MeshEdgeData,
  sourceNodePickIds: Uint32Array | undefined,
): Pick<PartResource, "edgeVertexBuffer" | "edgeIndexBuffer" | "edgeNodePickIdsBuffer"> {
  return {
    edgeVertexBuffer: createBuffer(device, edgeData.positions, GPUBufferUsage.VERTEX),
    edgeIndexBuffer: createIndexBuffer(device, edgeData.indices),
    edgeNodePickIdsBuffer: createBuffer(
      device,
      buildEdgeNodePickIds(edgeData.sourceVertexIndices, sourceNodePickIds),
      GPUBufferUsage.STORAGE,
    ),
  };
}

/** Releases every part, storage, and depth resource owned by the draw path. */
export function destroyDrawResources(draw: DrawResources): void {
  for (const resource of draw.parts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
    resource.elementPickIdsBuffer.destroy();
    resource.facePickIdsBuffer.destroy();
    resource.nodePickIdsBuffer.destroy();
    resource.edgeNodePickIdsBuffer.destroy();
    resource.geometryDataBuffer.destroy();
    resource.edgeVertexBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
    resource.subsetIndexBuffer?.destroy();
    resource.subsetVertexBuffer?.destroy();
    resource.subsetNodePickIdsBuffer?.destroy();
    resource.subsetGeometryDataBuffer?.destroy();
    resource.subsetEdgeVertexBuffer?.destroy();
    resource.subsetEdgeIndexBuffer?.destroy();
  }
  for (const resource of draw.nodeParts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
    resource.elementPickIdsBuffer.destroy();
    resource.facePickIdsBuffer.destroy();
    resource.nodePickIdsBuffer.destroy();
    resource.edgeNodePickIdsBuffer.destroy();
    resource.geometryDataBuffer.destroy();
    resource.edgeVertexBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
    resource.subsetIndexBuffer?.destroy();
    resource.subsetVertexBuffer?.destroy();
    resource.subsetNodePickIdsBuffer?.destroy();
    resource.subsetGeometryDataBuffer?.destroy();
    resource.subsetEdgeVertexBuffer?.destroy();
    resource.subsetEdgeIndexBuffer?.destroy();
  }
  for (const storage of draw.storages.values()) {
    storage.buffer.destroy();
    storage.orderBuffer.destroy();
    storage.selectionOrderBuffer.destroy();
    storage.nodeSelectionOrderBuffer.destroy();
    storage.transparentOrderBuffer.destroy();
    storage.edgeOrderBuffer.destroy();
    storage.nodeOrderBuffer.destroy();
    storage.highlight.buffer.destroy();
  }
  destroyDeformationBuffers(draw.deformations);
  destroyColorTargets(draw.targets);
}
