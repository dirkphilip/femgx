import type { Part, Primitive } from "../geometry/part";
import type { PartId } from "../scene/types";
import { orderBindGroup } from "./gpu-bind-groups";
import {
  destroyDeformationBuffers,
  ensureDeformationBuffer,
  type DeformationStorage,
} from "./gpu-deform";
import { buildMeshEdges } from "./gpu-elements";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  buildCornerPositions,
  buildElementTrianglePickIds,
  buildFaceTrianglePickIds,
  buildVertexNodePickIds,
} from "./gpu-pick-ids";
import type { DrawPipelines } from "./gpu-pipelines";
import { createBuffer, type PartResource } from "./gpu-support";

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
  readonly storages: Map<PartId, InstanceStorage>;
  readonly deformations: Map<PartId, DeformationStorage>;
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
    storages: new Map(),
    deformations: new Map(),
    depthTexture: undefined,
    depthWidth: 0,
    depthHeight: 0,
  };
}

/**
 * Returns the cached geometry buffers for a part, uploading them once. Only
 * triangle parts carry a deduplicated edge list, so the edge overlay never
 * draws spurious edges for line or point primitives.
 */
export function uploadPart(draw: DrawResources, part: Part): PartResource {
  const existing = draw.parts.get(part.id);
  if (existing !== undefined) return existing;
  const vertexBuffer = createBuffer(draw.device, part.geometry.positions, GPUBufferUsage.VERTEX);
  const indexBuffer = createBuffer(draw.device, part.geometry.indices, GPUBufferUsage.INDEX);
  const triangles = part.geometry.primitive !== "lines" && part.geometry.primitive !== "points";
  const edges = triangles ? buildMeshEdges(part.geometry) : new Uint32Array(0);
  const elementPickIdsBuffer = createBuffer(
    draw.device,
    buildElementTrianglePickIds(part.geometry),
    GPUBufferUsage.STORAGE,
  );
  const facePickIdsBuffer = createBuffer(
    draw.device,
    buildFaceTrianglePickIds(part.geometry),
    GPUBufferUsage.STORAGE,
  );
  const nodePickIdsBuffer = createBuffer(
    draw.device,
    buildVertexNodePickIds(part.geometry),
    GPUBufferUsage.STORAGE,
  );
  const cornerPositionsBuffer = createBuffer(
    draw.device,
    buildCornerPositions(part.geometry),
    GPUBufferUsage.STORAGE,
  );
  const edgeIndexBuffer = createBuffer(
    draw.device,
    edges.length > 0 ? edges : new Uint32Array(1),
    GPUBufferUsage.INDEX,
  );
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    elementPickIdsBuffer,
    facePickIdsBuffer,
    nodePickIdsBuffer,
    cornerPositionsBuffer,
    edgeIndexBuffer,
    indexCount: part.geometry.indices.length,
    edgeIndexCount: edges.length,
  };
  draw.parts.set(part.id, resource);
  return resource;
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
  pass.setBindGroup(0, context.frameBindGroup);
  let current: GPURenderPipeline | undefined;
  for (const call of calls) {
    const part = context.parts.get(call.partId);
    const storage = draw.storages.get(call.partId);
    if (part === undefined || storage === undefined) continue;
    const geometry = uploadPart(draw, part);
    const pipeline =
      options.pipeline ??
      pipelineFor(part.geometry.primitive ?? "triangles", passKind, context.pipelines);
    if (current !== pipeline) {
      pass.setPipeline(pipeline);
      current = pipeline;
    }
    const deformation = ensureDeformationBuffer(draw.device, draw.deformations, call.partId);
    const group = orderBindGroup(draw.device, context.instanceLayout, storage, overlay, {
      geometry,
      deformation,
    });
    pass.setBindGroup(1, group);
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    const buffer = overlay ? geometry.edgeIndexBuffer : geometry.indexBuffer;
    const count = overlay ? geometry.edgeIndexCount : geometry.indexCount;
    pass.setIndexBuffer(buffer, "uint32");
    pass.drawIndexed(count, call.instanceCount);
  }
}

/** Selects the color or pick pipeline for a part's primitive kind. */
function pipelineFor(
  primitive: Primitive,
  pass: PipelinePass,
  pipelines: DrawPipelines,
): GPURenderPipeline {
  switch (primitive) {
    case "triangles":
      return pass === "color" ? pipelines.trianglesColor : pipelines.trianglesPick;
    case "lines":
      return pass === "color" ? pipelines.linesColor : pipelines.linesPick;
    case "points":
      return pass === "color" ? pipelines.pointsColor : pipelines.pointsPick;
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
    resource.cornerPositionsBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
  }
  for (const storage of draw.storages.values()) {
    storage.buffer.destroy();
    storage.orderBuffer.destroy();
    storage.edgeOrderBuffer.destroy();
    storage.highlight.buffer.destroy();
  }
  destroyDeformationBuffers(draw.deformations);
  draw.depthTexture?.destroy();
}
