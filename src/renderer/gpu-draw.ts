import { validateFaceSubset, type Part } from "../geometry/part";
import type { PartId } from "../scene/types";
import { destroyDeformationBuffers, type DeformationStorage } from "./gpu-deform";
import { buildMeshEdgeData, type MeshEdgeData } from "./gpu-edge";
import { buildFaceSubsetIndices } from "./gpu-face-subset";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  buildElementTrianglePickIds,
  buildNodeBodyPickData,
  buildNodeBodyOwnerData,
  buildNodeSpritePickIds,
  buildTriangleFaceBodyPickData,
  buildVertexNodePickIds,
} from "./gpu-pick-ids";
import type { DrawPipelines } from "./gpu-pipelines";
import { createBuffer, type PartResource } from "./gpu-support";
import { drawOneBatch, type BatchDrawOptions } from "./gpu-batch";

export {
  INSTANCE_STRIDE,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  patchInstances,
  writeDrawOrder,
  writeEdgeOrder,
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
  /** Multisampled color target resolved to the canvas each visible frame. */
  msaaColorTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  depthWidth: number;
  depthHeight: number;
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
    msaaColorTexture: undefined,
    depthTexture: undefined,
    depthWidth: 0,
    depthHeight: 0,
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
    indices.set(
      [0, 1, 2, 0, 2, 3].map((index) => index + sprite * 4),
      sprite * 6,
    );
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
      buildNodeBodyPickData(part.geometry, spritePickIds),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(draw.device, ids, GPUBufferUsage.STORAGE),
    edgeIndexBuffer: createBuffer(draw.device, new Uint32Array(1), GPUBufferUsage.INDEX),
    topologyBodyRangesBuffer: createBuffer(
      draw.device,
      nodeBodyData.bodyRanges,
      GPUBufferUsage.STORAGE,
    ),
    topologyBodyIdsBuffer: createBuffer(draw.device, nodeBodyData.bodyIds, GPUBufferUsage.STORAGE),
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
  validateFaceSubset(part.geometry);
  const vertexBuffer = createBuffer(
    draw.device,
    part.geometry.positions,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  );
  const indexBuffer = createBuffer(draw.device, part.geometry.indices, GPUBufferUsage.INDEX);
  const triangles = part.geometry.primitive !== "lines" && part.geometry.primitive !== "points";
  const subsetIndices =
    part.geometry.faceSubset === undefined ? undefined : buildFaceSubsetIndices(part.geometry);
  const edgeData = triangles
    ? buildMeshEdgeData(part.geometry, subsetIndices ?? part.geometry.indices)
    : emptyMeshEdgeData();
  const picks = uploadPickBuffers(draw, part);
  const edgeIndexBuffer = createIndexBuffer(draw.device, edgeData.indices);
  const subsetBuffers = createSubsetBuffers(draw.device, subsetIndices, edgeData);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    ...picks,
    edgeIndexBuffer,
    topologyBodyRangesBuffer: createBuffer(
      draw.device,
      edgeData.bodyRanges,
      GPUBufferUsage.STORAGE,
    ),
    topologyBodyIdsBuffer: createBuffer(draw.device, edgeData.bodyIds, GPUBufferUsage.STORAGE),
    indexCount: part.geometry.indices.length,
    edgeIndexCount: edgeData.indices.length,
    ...subsetBuffers,
    subsetIndexCount: subsetIndices?.length ?? 0,
    subsetEdgeIndexCount: part.geometry.faceSubset === undefined ? 0 : edgeData.indices.length,
  };
  draw.parts.set(part.id, resource);
  return resource;
}

function uploadPickBuffers(
  draw: DrawResources,
  part: Part,
): Pick<PartResource, "elementPickIdsBuffer" | "facePickIdsBuffer" | "nodePickIdsBuffer"> {
  return {
    elementPickIdsBuffer: createBuffer(
      draw.device,
      buildElementTrianglePickIds(part.geometry),
      GPUBufferUsage.STORAGE,
    ),
    facePickIdsBuffer: createBuffer(
      draw.device,
      buildTriangleFaceBodyPickData(part.geometry),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(
      draw.device,
      buildVertexNodePickIds(part.geometry),
      GPUBufferUsage.STORAGE,
    ),
  };
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
  indices: Uint32Array | undefined,
  edgeData: MeshEdgeData,
): Pick<
  PartResource,
  | "subsetIndexBuffer"
  | "subsetEdgeIndexBuffer"
  | "subsetTopologyBodyRangesBuffer"
  | "subsetTopologyBodyIdsBuffer"
> {
  if (indices === undefined) return {};
  return {
    subsetIndexBuffer: createIndexBuffer(device, indices),
    subsetEdgeIndexBuffer: createIndexBuffer(device, edgeData.indices),
    subsetTopologyBodyRangesBuffer: createBuffer(
      device,
      edgeData.bodyRanges,
      GPUBufferUsage.STORAGE,
    ),
    subsetTopologyBodyIdsBuffer: createBuffer(device, edgeData.bodyIds, GPUBufferUsage.STORAGE),
  };
}

function emptyMeshEdgeData(): MeshEdgeData {
  return {
    indices: new Uint32Array(),
    bodyRanges: new Uint32Array([0, 0]),
    bodyIds: new Uint32Array([0]),
  };
}

/** Which fragment pass a batch targets. */
export type PipelinePass = "color" | "pick";

/** Options controlling one instanced draw pass. */
export interface DrawBatchOptions {
  /** Which fragment pass the batch targets; selects color vs pick pipelines. */
  readonly pass?: PipelinePass;
  /** Explicit pipeline override for overlay passes such as the wireframe edges. */
  readonly pipeline?: GPURenderPipeline;
  /**
   * Draws through the part's edge-overlay order and edge index buffers instead
   * of the surface draw order, addressing only the instances whose style
   * requests the line overlay.
   */
  readonly overlay?: boolean;
  /** Draws one small point sprite for every FE node of each visible part. */
  readonly nodes?: boolean;
}

/**
 * Issues all instanced draws for the cached per-part calls. The pipeline is
 * switched per part to match its primitive topology (triangle/line/point
 * sprite), so one pass can mix element solids, edges, and point elements. The
 * storage record buffer is addressed through the compacted draw-order buffer so
 * hidden slots are never drawn; bind groups are cached per storage.
 */
export function drawBatches(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  calls: readonly DrawCall[],
  options: DrawBatchOptions = {},
): void {
  const passKind = options.pass ?? "color";
  const overlay = options.overlay === true;
  const nodes = options.nodes === true;
  pass.setBindGroup(0, context.frameBindGroup);
  let current: GPURenderPipeline | undefined;
  for (const call of calls) {
    const batchOptions: BatchDrawOptions = {
      passKind,
      overlay,
      nodes,
      pipelineOverride: options.pipeline,
      current,
    };
    current = drawOneBatch(pass, draw, context, call, batchOptions);
  }
}

/** Releases every part, storage, and depth resource owned by the draw path. */
export function destroyDrawResources(draw: DrawResources): void {
  for (const resource of draw.parts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
    resource.elementPickIdsBuffer.destroy();
    resource.facePickIdsBuffer.destroy();
    resource.nodePickIdsBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
    resource.topologyBodyRangesBuffer.destroy();
    resource.topologyBodyIdsBuffer.destroy();
    resource.subsetIndexBuffer?.destroy();
    resource.subsetEdgeIndexBuffer?.destroy();
    resource.subsetTopologyBodyRangesBuffer?.destroy();
    resource.subsetTopologyBodyIdsBuffer?.destroy();
  }
  for (const resource of draw.nodeParts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
    resource.elementPickIdsBuffer.destroy();
    resource.facePickIdsBuffer.destroy();
    resource.nodePickIdsBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
    resource.topologyBodyRangesBuffer.destroy();
    resource.topologyBodyIdsBuffer.destroy();
    resource.subsetIndexBuffer?.destroy();
    resource.subsetEdgeIndexBuffer?.destroy();
    resource.subsetTopologyBodyRangesBuffer?.destroy();
    resource.subsetTopologyBodyIdsBuffer?.destroy();
  }
  for (const storage of draw.storages.values()) {
    storage.buffer.destroy();
    storage.orderBuffer.destroy();
    storage.edgeOrderBuffer.destroy();
    storage.highlight.buffer.destroy();
  }
  destroyDeformationBuffers(draw.deformations);
  draw.msaaColorTexture?.destroy();
  draw.depthTexture?.destroy();
}
