import type { Part } from "../geometry/part";
import type { ResolvedStyle } from "../interaction/interaction";
import type { PartId } from "../scene/types";
import {
  buildElementTrianglePickIds,
  buildMeshEdges,
  createHighlightStorage,
  type HighlightStorage,
} from "./gpu-elements";
import { createBuffer, type PartResource } from "./gpu-support";

/** Byte size of one instance record in the per-part storage buffer. */
const INSTANCE_STRIDE = 96;

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
 * draw-order buffer, and a fixed-capacity element-highlight buffer. Hidden
 * instances stay in the record buffer but are removed from the draw-order
 * list, so only visible geometry is ever drawn.
 */
export interface InstanceStorage {
  readonly buffer: GPUBuffer;
  readonly orderBuffer: GPUBuffer;
  readonly highlight: HighlightStorage;
  readonly capacity: number;
  /** CPU mirror of the record buffer, kept in sync by the patch functions. */
  data: ArrayBuffer;
  /** CPU mirror of the draw-order buffer. */
  orderData: Uint32Array;
  /** Number of meaningful draw-order entries. */
  orderLength: number;
  /** Cached bind group; invalidated whenever the storage buffers grow. */
  bindGroup: GPUBindGroup | undefined;
}

/** Per-part geometry and instance storage buffers owned by the draw path. */
export interface DrawResources {
  readonly device: GPUDevice;
  readonly parts: Map<PartId, PartResource>;
  readonly storages: Map<PartId, InstanceStorage>;
  depthTexture: GPUTexture | undefined;
  depthWidth: number;
  depthHeight: number;
}

/** Per-frame inputs shared by every draw batch of a pass. */
export interface DrawCallContext {
  readonly cameraBindGroup: GPUBindGroup;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
}

/** Creates the draw-path resource owner. */
export function createDrawResources(device: GPUDevice): DrawResources {
  return {
    device,
    parts: new Map(),
    storages: new Map(),
    depthTexture: undefined,
    depthWidth: 0,
    depthHeight: 0,
  };
}

/** Returns the cached geometry buffers for a part, uploading them once. */
export function uploadPart(draw: DrawResources, part: Part): PartResource {
  const existing = draw.parts.get(part.id);
  if (existing !== undefined) return existing;
  const vertexBuffer = createBuffer(draw.device, part.geometry.positions, GPUBufferUsage.VERTEX);
  const indexBuffer = createBuffer(draw.device, part.geometry.indices, GPUBufferUsage.INDEX);
  const edges = buildMeshEdges(part.geometry);
  const elementPickIdsBuffer = createBuffer(
    draw.device,
    buildElementTrianglePickIds(part.geometry),
    GPUBufferUsage.STORAGE,
  );
  const edgeIndexBuffer = createBuffer(draw.device, edges, GPUBufferUsage.INDEX);
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
  const ids = new Uint32Array(data);
  floats.set(transform, 0);
  floats.set([style.color.r, style.color.g, style.color.b, style.color.a * style.opacity], 16);
  ids[20] = pickId;
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
  const mirror = storage.orderData;
  const length = Math.max(order.length, storage.orderLength);
  let rangeStart = -1;
  for (let index = 0; index < length; index++) {
    const next = index < order.length ? (order[index] ?? 0) : 0;
    const previous = index < storage.orderLength ? (mirror[index] ?? 0) : 0;
    const changed = index < order.length !== index < storage.orderLength || next !== previous;
    if (changed && rangeStart < 0) rangeStart = index;
    if ((!changed || index === length - 1) && rangeStart >= 0) {
      const rangeEnd = changed && index === length - 1 ? index + 1 : index;
      const chunk = new Uint32Array(rangeEnd - rangeStart);
      for (let i = rangeStart; i < rangeEnd; i++) {
        chunk[i - rangeStart] = i < order.length ? (order[i] ?? 0) : 0;
      }
      draw.device.queue.writeBuffer(storage.orderBuffer, rangeStart * 4, chunk);
      rangeStart = -1;
    }
  }
  mirror.set(order);
  storage.orderLength = order.length;
}

/** Which index buffer a draw batch should use. */
export type IndexSource = "triangles" | "edges";

/** Options controlling one instanced draw pass. */
export interface DrawBatchOptions {
  readonly pipeline: GPURenderPipeline;
  /** Which per-part index buffer to draw from; defaults to triangles. */
  readonly index?: IndexSource;
}

/**
 * Issues all instanced draws for the cached per-part calls. The storage record
 * buffer is addressed through the compacted draw-order buffer so hidden slots
 * are never drawn; bind groups are cached per storage and reused across frames.
 */
export function drawBatches(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  calls: readonly DrawCall[],
  options: DrawBatchOptions,
): void {
  const { pipeline, index = "triangles" } = options;
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, context.cameraBindGroup);
  for (const call of calls) {
    const part = context.parts.get(call.partId);
    const storage = draw.storages.get(call.partId);
    if (part === undefined || storage === undefined) continue;
    const geometry = uploadPart(draw, part);
    if (storage.bindGroup === undefined) {
      storage.bindGroup = draw.device.createBindGroup({
        layout: context.instanceLayout,
        entries: [
          { binding: 0, resource: { buffer: storage.buffer } },
          { binding: 1, resource: { buffer: storage.orderBuffer } },
          { binding: 2, resource: { buffer: geometry.elementPickIdsBuffer } },
          { binding: 3, resource: { buffer: storage.highlight.buffer } },
        ],
      });
    }
    pass.setBindGroup(1, storage.bindGroup);
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    const edges = index === "edges";
    const buffer = edges ? geometry.edgeIndexBuffer : geometry.indexBuffer;
    const count = edges ? geometry.edgeIndexCount : geometry.indexCount;
    pass.setIndexBuffer(buffer, "uint32");
    pass.drawIndexed(count, call.instanceCount);
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
    storage.highlight.buffer.destroy();
  }
  draw.depthTexture?.destroy();
}

/** Returns the existing per-part storage, creating or growing it as needed. */
function ensureStorage(draw: DrawResources, partId: PartId, capacity: number): InstanceStorage {
  const existing = draw.storages.get(partId);
  if (existing !== undefined && existing.capacity >= capacity) return existing;
  const size =
    existing === undefined ? Math.max(1, capacity) : Math.max(capacity, existing.capacity * 2);
  const buffer = draw.device.createBuffer({
    size: size * INSTANCE_STRIDE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const orderBuffer = draw.device.createBuffer({
    size: size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const mirror = new Uint8Array(size * INSTANCE_STRIDE);
  const orderData = new Uint32Array(size);
  const orderLength = existing?.orderLength ?? 0;
  const highlight = existing?.highlight ?? createHighlightStorage(draw.device);
  if (existing !== undefined) {
    mirror.set(new Uint8Array(existing.data));
    orderData.set(existing.orderData.subarray(0, orderLength));
  }
  const storage: InstanceStorage = {
    buffer,
    orderBuffer,
    highlight,
    capacity: size,
    data: mirror.buffer,
    orderData,
    orderLength,
    bindGroup: undefined,
  };
  if (existing !== undefined && existing.orderLength > 0) {
    draw.device.queue.writeBuffer(orderBuffer, 0, orderData.subarray(0, orderLength));
  }
  if (existing !== undefined) {
    draw.device.queue.writeBuffer(buffer, 0, mirror);
  }
  draw.storages.set(partId, storage);
  return storage;
}

/**
 * Writes the changed contiguous byte ranges of a region into a GPU buffer.
 * Each written range is expanded outward to a 4-byte boundary because
 * `GPUQueue.writeBuffer` rejects byte lengths and offsets that are not a
 * multiple of 4, and instance records change in sub-float byte increments
 * (for example a single alpha byte).
 */
function writeDiffedRange(
  device: GPUDevice,
  buffer: GPUBuffer,
  baseOffset: number,
  next: Uint8Array<ArrayBuffer>,
  previous: Uint8Array<ArrayBuffer>,
): void {
  let rangeStart = -1;
  for (let index = 0; index < next.length; index++) {
    const changed = next[index] !== previous[index];
    if (changed && rangeStart < 0) rangeStart = index;
    if ((!changed || index === next.length - 1) && rangeStart >= 0) {
      const rangeEnd = changed && index === next.length - 1 ? index + 1 : index;
      const alignedStart = rangeStart - (rangeStart % 4);
      const alignedEnd = Math.min(next.length, rangeEnd + ((4 - (rangeEnd % 4)) % 4));
      device.queue.writeBuffer(
        buffer,
        baseOffset + alignedStart,
        next.subarray(alignedStart, alignedEnd),
      );
      rangeStart = -1;
    }
  }
}
