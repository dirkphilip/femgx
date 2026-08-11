import { validateFaceSubset, type Part, type Primitive } from "../geometry/part";
import type { PartId } from "../scene/types";
import { orderBindGroup } from "./gpu-bind-groups";
import {
  destroyDeformationBuffers,
  ensureDeformationBuffer,
  type DeformationStorage,
} from "./gpu-deform";
import { buildMeshEdges } from "./gpu-edge";
import { buildFaceSubsetIndices } from "./gpu-face-subset";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  buildElementTrianglePickIds,
  buildNodeBodyPickData,
  buildTriangleFaceBodyPickData,
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
  readonly nodeParts: Map<PartId, PartResource>;
  readonly storages: Map<PartId, InstanceStorage>;
  readonly deformations: Map<PartId, DeformationStorage>;
  /** Multisampled color target resolved to the canvas each visible frame. */
  msaaColorTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  nodeDepthBindGroup: GPUBindGroup | undefined;
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
    nodeDepthBindGroup: undefined,
    depthWidth: 0,
    depthHeight: 0,
  };
}

function uploadNodePart(draw: DrawResources, part: Part): PartResource {
  const existing = draw.nodeParts.get(part.id);
  if (existing !== undefined) return existing;
  const nodes = part.geometry.nodePositions ?? new Float32Array(0);
  const count = nodes.length / 3;
  const positions = new Float32Array(count * 12);
  const ids = new Uint32Array(count * 4);
  const indices = new Uint32Array(count * 6);
  for (let node = 0; node < count; node += 1) {
    const source = node * 3;
    for (let corner = 0; corner < 4; corner += 1) {
      positions.set(nodes.subarray(source, source + 3), (node * 4 + corner) * 3);
      ids[node * 4 + corner] = node + 1;
    }
    indices.set(
      [0, 1, 2, 0, 2, 3].map((index) => index + node * 4),
      node * 6,
    );
  }
  const resource: PartResource = {
    vertexBuffer: createBuffer(
      draw.device,
      positions,
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
    ),
    indexBuffer: createBuffer(draw.device, indices, GPUBufferUsage.INDEX),
    elementPickIdsBuffer: createBuffer(draw.device, new Uint32Array(1), GPUBufferUsage.STORAGE),
    facePickIdsBuffer: createBuffer(
      draw.device,
      buildNodeBodyPickData(part.geometry),
      GPUBufferUsage.STORAGE,
    ),
    nodePickIdsBuffer: createBuffer(draw.device, ids, GPUBufferUsage.STORAGE),
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
  const edges = triangles
    ? buildMeshEdges(part.geometry, subsetIndices ?? part.geometry.indices)
    : new Uint32Array(0);
  const picks = uploadPickBuffers(draw, part);
  const edgeIndexBuffer = createIndexBuffer(draw.device, edges);
  const subsetBuffers = createSubsetBuffers(draw.device, subsetIndices, edges);
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    ...picks,
    edgeIndexBuffer,
    indexCount: part.geometry.indices.length,
    edgeIndexCount: edges.length,
    ...subsetBuffers,
    subsetIndexCount: subsetIndices?.length ?? 0,
    subsetEdgeIndexCount: part.geometry.faceSubset === undefined ? 0 : edges.length,
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
  edges: Uint32Array,
): Pick<PartResource, "subsetIndexBuffer" | "subsetEdgeIndexBuffer"> {
  if (indices === undefined) return {};
  return {
    subsetIndexBuffer: createIndexBuffer(device, indices),
    subsetEdgeIndexBuffer: createIndexBuffer(device, edges),
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
    const part = context.parts.get(call.partId);
    const storage = draw.storages.get(call.partId);
    if (part === undefined || storage === undefined) continue;
    const geometry = nodes ? uploadNodePart(draw, part) : uploadPart(draw, part);
    const subset = !nodes && part.geometry.faceSubset !== undefined;
    if (overlay && (subset ? geometry.subsetEdgeIndexCount : geometry.edgeIndexCount) === 0) {
      continue;
    }
    if (!overlay && subset && geometry.subsetIndexCount === 0) continue;
    const pipeline =
      options.pipeline ??
      pipelineFor(
        nodes ? "points" : (part.geometry.primitive ?? "triangles"),
        passKind,
        context.pipelines,
      );
    if (current !== pipeline) {
      pass.setPipeline(pipeline);
      current = pipeline;
    }
    const deformation = ensureDeformationBuffer(draw.device, draw.deformations, call.partId);
    const group = orderBindGroup(draw.device, context.instanceLayout, storage, overlay, {
      geometry,
      deformation,
      cache: !nodes,
    });
    pass.setBindGroup(1, group);
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    const buffer = overlay
      ? subset
        ? geometry.subsetEdgeIndexBuffer
        : geometry.edgeIndexBuffer
      : subset
        ? geometry.subsetIndexBuffer
        : geometry.indexBuffer;
    const count = overlay
      ? subset
        ? geometry.subsetEdgeIndexCount
        : geometry.edgeIndexCount
      : subset
        ? geometry.subsetIndexCount
        : geometry.indexCount;
    if (buffer === undefined) continue;
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
      return pipelineVariant(pass, pipelines.trianglesColor, pipelines.trianglesPick);
    case "lines":
      return pipelineVariant(pass, pipelines.linesColor, pipelines.linesPick);
    case "points":
      return pipelineVariant(pass, pipelines.pointsColor, pipelines.pointsPick);
  }
}

function pipelineVariant(
  pass: PipelinePass,
  color: GPURenderPipeline,
  pick: GPURenderPipeline,
): GPURenderPipeline {
  return pass === "color" ? color : pick;
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
    resource.subsetIndexBuffer?.destroy();
    resource.subsetEdgeIndexBuffer?.destroy();
  }
  for (const resource of draw.nodeParts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
    resource.elementPickIdsBuffer.destroy();
    resource.facePickIdsBuffer.destroy();
    resource.nodePickIdsBuffer.destroy();
    resource.edgeIndexBuffer.destroy();
    resource.subsetIndexBuffer?.destroy();
    resource.subsetEdgeIndexBuffer?.destroy();
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
