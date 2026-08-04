import type { Part, Primitive } from "../geometry/part";
import type { ResolvedStyle } from "../interaction/interaction";
import type { PartId } from "../scene/types";
import {
  buildElementTrianglePickIds,
  buildMeshEdges,
  createHighlightStorage,
  type HighlightStorage,
} from "./gpu-elements";
import type { DrawPipelines } from "./gpu-pipelines";
import { createBuffer, type PartResource } from "./gpu-support";
import { writeDiffedRange, writeOrderBuffer } from "./gpu-writes";
import { orderBindGroup } from "./gpu-bind-groups";
import {
  destroyDeformationBuffers,
  ensureDeformationBuffer,
  type DeformationStorage,
} from "./gpu-deform";

/** Byte size of one instance record in the per-part storage buffer. */
export const INSTANCE_STRIDE = 96;

/**
 * Byte offset of the `emissive` scalar within an instance record. The record
 * layout is mirrored by the `Instance` struct in `gpu-shaders.ts`:
 *
 * | offset | size | field |
 * | ------ | ---- | ----- |
 * | 0      | 64   | world transform (`mat4x4<f32>`) |
 * | 64     | 16   | resolved color, opacity folded into alpha (`vec4<f32>`) |
 * | 80     | 4    | stable pick id (`u32`) |
 * | 84     | 4    | emissive (`f32`) |
 * | 88     | 8    | padding (`vec2<u32>`) |
 */
export const EMISSIVE_BYTE_OFFSET = 84;

/** One pre-encoded instance record written into a per-part buffer. */
export interface InstanceUpdate {
  /** Part-local slot index (stable across visibility changes). */
  readonly slot: number;
  /** `INSTANCE_STRIDE`-byte encoded transform/style/pick record. */
  readonly data: ArrayBuffer;
}

/** A single instanced draw for one part. */
export interface DrawCall {
  readonly partId: PartId;
  readonly instanceCount: number;
}

/**
 * Persistent per-part GPU storage: a slot-stable record buffer, a compacted
 * draw-order buffer, a compacted edge-overlay order buffer, and a
 * fixed-capacity element-highlight buffer. Hidden instances stay in the record
 * buffer but are removed from the draw-order lists, so only visible geometry is
 * ever drawn. The edge order holds the subset of visible instances whose
 * resolved style requests the line-overlay pass.
 */
export interface InstanceStorage {
  readonly buffer: GPUBuffer;
  readonly orderBuffer: GPUBuffer;
  readonly edgeOrderBuffer: GPUBuffer;
  readonly highlight: HighlightStorage;
  readonly capacity: number;
  /** CPU mirror of the record buffer, kept in sync by the patch functions. */
  data: ArrayBuffer;
  /** CPU mirror of the draw-order buffer. */
  orderData: Uint32Array;
  /** Number of meaningful draw-order entries. */
  orderLength: number;
  /** CPU mirror of the edge-overlay order buffer. */
  edgeOrderData: Uint32Array;
  /** Number of meaningful edge-overlay order entries. */
  edgeOrderLength: number;
  /** Cached bind group; invalidated whenever the storage buffers grow. */
  bindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the edge-order buffer; invalidated on growth. */
  edgeBindGroup: GPUBindGroup | undefined;
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
  const edgeIndexBuffer = createBuffer(
    draw.device,
    edges.length > 0 ? edges : new Uint32Array(1),
    GPUBufferUsage.INDEX,
  );
  const resource: PartResource = {
    vertexBuffer,
    indexBuffer,
    elementPickIdsBuffer,
    edgeIndexBuffer,
    indexCount: part.geometry.indices.length,
    edgeIndexCount: edges.length,
  };
  draw.parts.set(part.id, resource);
  return resource;
}

/**
 * Encodes one instance record: column-major world transform, resolved color
 * (with opacity folded into alpha), a stable pick id derived from the
 * instance slot, and the resolved emissive used for hover/highlight glow.
 */
export function encodeInstanceRecord(
  transform: Float32Array,
  style: ResolvedStyle,
  pickId: number,
): ArrayBuffer {
  const data = new ArrayBuffer(INSTANCE_STRIDE);
  const floats = new Float32Array(data);
  new Uint32Array(data)[20] = pickId;
  floats.set(transform, 0);
  floats.set([style.color.r, style.color.g, style.color.b, style.color.a * style.opacity], 16);
  floats[EMISSIVE_BYTE_OFFSET / 4] = style.emissive;
  return data;
}

/**
 * Writes only the byte subranges whose records changed since the last patch,
 * coalescing adjacent changed slots into single buffer writes.
 */
export function patchInstances(
  draw: DrawResources,
  partId: PartId,
  updates: readonly InstanceUpdate[],
): void {
  if (updates.length === 0) return;
  const sorted = [...updates].sort((a, b) => a.slot - b.slot);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return;
  const storage = ensureStorage(draw, partId, last.slot + 1);
  const startByte = first.slot * INSTANCE_STRIDE;
  const endByte = (last.slot + 1) * INSTANCE_STRIDE;
  const mirror = new Uint8Array(storage.data);
  const region = new Uint8Array(endByte - startByte);
  region.set(mirror.subarray(startByte, endByte));
  for (const update of sorted) {
    const offset = (update.slot - first.slot) * INSTANCE_STRIDE;
    region.set(new Uint8Array(update.data), offset);
  }
  writeDiffedRange(
    draw.device,
    storage.buffer,
    startByte,
    region,
    mirror.subarray(startByte, endByte),
  );
  mirror.set(region, startByte);
}

/**
 * Replaces the compacted draw-order list of a part. Only the changed u32
 * subranges are uploaded, so a visibility delta touches at most the affected
 * part buffers.
 */
export function writeDrawOrder(draw: DrawResources, partId: PartId, order: Uint32Array): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  storage.orderLength = writeOrderBuffer(
    draw.device,
    storage.orderBuffer,
    storage.orderData,
    order,
    storage.orderLength,
  );
}

/**
 * Replaces the compacted edge-overlay order list of a part (visible instances
 * whose resolved style requests the line overlay). Like `writeDrawOrder`, only
 * the changed u32 subranges reach the GPU.
 */
export function writeEdgeOrder(draw: DrawResources, partId: PartId, order: Uint32Array): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  storage.edgeOrderLength = writeOrderBuffer(
    draw.device,
    storage.edgeOrderBuffer,
    storage.edgeOrderData,
    order,
    storage.edgeOrderLength,
  );
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

/** Returns the existing per-part storage, creating or growing it as needed. */
function ensureStorage(draw: DrawResources, partId: PartId, capacity: number): InstanceStorage {
  const existing = draw.storages.get(partId);
  if (existing !== undefined && existing.capacity >= capacity) return existing;
  const size = Math.max(capacity, existing === undefined ? 1 : existing.capacity * 2);
  const buffer = draw.device.createBuffer({
    size: size * INSTANCE_STRIDE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const orderBuffer = createOrderBuffer(draw.device, size);
  const edgeOrderBuffer = createOrderBuffer(draw.device, size);
  const mirror = new Uint8Array(size * INSTANCE_STRIDE);
  const orderData = new Uint32Array(size);
  const edgeOrderData = new Uint32Array(size);
  const orderLength = existing?.orderLength ?? 0;
  const edgeOrderLength = existing?.edgeOrderLength ?? 0;
  const highlight = existing?.highlight ?? createHighlightStorage(draw.device);
  if (existing !== undefined) {
    mirror.set(new Uint8Array(existing.data));
    orderData.set(existing.orderData.subarray(0, orderLength));
    edgeOrderData.set(existing.edgeOrderData.subarray(0, edgeOrderLength));
  }
  const storage: InstanceStorage = {
    buffer,
    orderBuffer,
    edgeOrderBuffer,
    highlight,
    capacity: size,
    data: mirror.buffer,
    orderData,
    orderLength,
    edgeOrderData,
    edgeOrderLength,
    bindGroup: undefined,
    edgeBindGroup: undefined,
  };
  if (existing !== undefined && existing.orderLength > 0) {
    draw.device.queue.writeBuffer(orderBuffer, 0, orderData.subarray(0, orderLength));
  }
  if (existing !== undefined && existing.edgeOrderLength > 0) {
    draw.device.queue.writeBuffer(edgeOrderBuffer, 0, edgeOrderData.subarray(0, edgeOrderLength));
  }
  if (existing !== undefined) {
    draw.device.queue.writeBuffer(buffer, 0, mirror);
  }
  draw.storages.set(partId, storage);
  return storage;
}

/** Creates a u32 storage buffer sized to the part's slot capacity. */
function createOrderBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size: size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
