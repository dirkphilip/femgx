import type { Part } from "../geometry/part";
import type { PartId } from "../geometry/part";
import { destroyDeformationBuffers, type DeformationStorage } from "./gpu-deform";
import { packTopologyData } from "./gpu-geometry-buffers";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  buildNodeBodyPickData,
  buildNodeBodyOwnerData,
  buildNodeSpritePickIds,
} from "./gpu-pick-ids";
import type { DrawPipelines } from "./gpu-pipelines";
import { expandSurfaceGeometry, type SurfaceVertexData } from "./gpu-surface-geometry";
import { createBuffer, type PartResource } from "./gpu-support";
import { appendResultColorTail, createResultColorTail } from "./gpu-result-colors";
import { buildPartGeometryData } from "./gpu-geometry-upload";
import { createColorTargets, destroyColorTargets, type ColorTargets } from "./gpu-targets";

const POINT_SPRITE_INDICES = [0, 1, 2, 0, 2, 3] as const;

function createGeometryBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
  return createBuffer(device, data, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
}

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
  readonly resultColors: ReadonlyMap<PartId, Float32Array> | undefined;
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
export function uploadNodePart(
  draw: DrawResources,
  part: Part,
  resultColors?: Float32Array,
): PartResource {
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
  const resultTail = createResultColorTail(ids, resultColors);
  const vertexWithResults = appendResultColorTail(positions, resultTail);
  const vertexBuffer = createGeometryBuffer(draw.device, vertexWithResults.data);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer: createBuffer(draw.device, indices, GPUBufferUsage.INDEX),
    resultColorBuffers: [{ buffer: vertexBuffer, offset: vertexWithResults.offset }],
    resultColorNodeCount: resultTail.resultColorNodeCount,
    resultColorsSource: resultColors,
    resultColorsActive: resultColors !== undefined,
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
export function uploadPart(
  draw: DrawResources,
  part: Part,
  resultColors?: Float32Array,
): PartResource {
  const existing = draw.parts.get(part.id);
  if (existing !== undefined) return existing;
  const vertexData: SurfaceVertexData | PointVertexData =
    part.geometry.primitive === "points"
      ? expandPointGeometry(part.geometry)
      : expandSurfaceGeometry(part.geometry);
  const resultTail = createResultColorTail(vertexData.nodePickIds, resultColors);
  const vertexWithResults = appendResultColorTail(vertexData.positions, resultTail);
  const vertexBuffer = createBuffer(
    draw.device,
    vertexWithResults.data,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  const indexBuffer = createBuffer(draw.device, vertexData.indices, GPUBufferUsage.INDEX);
  const geometryData = buildPartGeometryData(draw.device, part, vertexData, resultTail);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    resultColorBuffers: [
      { buffer: vertexBuffer, offset: vertexWithResults.offset },
      geometryData.edgeResultColorBinding,
      ...(geometryData.subsetResultColorBinding === undefined
        ? []
        : [geometryData.subsetResultColorBinding]),
      ...(geometryData.subsetEdgeResultColorBinding === undefined
        ? []
        : [geometryData.subsetEdgeResultColorBinding]),
    ],
    resultColorNodeCount: resultTail.resultColorNodeCount,
    resultColorsSource: resultColors,
    resultColorsActive: resultColors !== undefined,
    ...geometryData.picks,
    facePickIdsBuffer: geometryData.facePickIdsBuffer,
    ...geometryData.edgeBuffers,
    indexCount: vertexData.indices.length,
    edgeIndexCount: geometryData.edgeData.indices.length,
    ...geometryData.subsetBuffers,
    subsetIndexCount: geometryData.subsetIndices?.length ?? 0,
    subsetEdgeIndexCount: geometryData.hasSubset ? geometryData.edgeData.indices.length : 0,
  };
  draw.parts.set(part.id, resource);
  return resource;
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

/** Releases every part, storage, and depth resource owned by the draw path. */
export function destroyDrawResources(draw: DrawResources): void {
  for (const resource of draw.parts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
    resource.elementPickIdsBuffer.destroy();
    resource.facePickIdsBuffer.destroy();
    resource.nodePickIdsBuffer.destroy();
    resource.edgeNodePickIdsBuffer.destroy();
    resource.edgeVertexBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
    resource.subsetIndexBuffer?.destroy();
    resource.subsetVertexBuffer?.destroy();
    resource.subsetNodePickIdsBuffer?.destroy();
    resource.subsetTopologyBuffer?.destroy();
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
    resource.edgeVertexBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
    resource.subsetIndexBuffer?.destroy();
    resource.subsetVertexBuffer?.destroy();
    resource.subsetNodePickIdsBuffer?.destroy();
    resource.subsetTopologyBuffer?.destroy();
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
