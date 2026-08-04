import type { Part } from "../geometry/part";
import type { ResolvedStyle } from "../interaction/interaction";
import type { PartId } from "../scene/types";
import { createBuffer, type PartResource } from "./gpu-support";

/** Byte size of one instance record in the per-part storage buffer. */
const INSTANCE_STRIDE = 96;

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
 * Persistent per-part GPU storage: a slot-stable record buffer and a compacted
 * draw-order buffer. Hidden instances stay in the record buffer but are removed
 * from the draw-order list, so only visible geometry is ever drawn.
 */
export interface InstanceStorage {
  readonly buffer: GPUBuffer;
  readonly orderBuffer: GPUBuffer;
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
  const resource = { vertexBuffer, indexBuffer, indexCount: part.geometry.indices.length };
  draw.parts.set(part.id, resource);
  return resource;
}

/**
 * Encodes one instance record: column-major world transform, resolved color
 * (with opacity folded into alpha), and a stable pick id derived from the
 * instance slot.
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

/** Creates a depth attachment sized to the given canvas dimensions. */
export function createDepthTexture(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
): GPUTexture {
  return device.createTexture({
    size: [width, height],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/** Returns the cached depth texture, recreating it only when the canvas size changes. */
export function ensureDepthTexture(
  draw: DrawResources,
  width: number,
  height: number,
  format: GPUTextureFormat,
): GPUTexture {
  if (draw.depthTexture !== undefined && draw.depthWidth === width && draw.depthHeight === height) {
    return draw.depthTexture;
  }
  draw.depthTexture?.destroy();
  const texture = createDepthTexture(draw.device, width, height, format);
  draw.depthTexture = texture;
  draw.depthWidth = width;
  draw.depthHeight = height;
  return texture;
}

/** Begins the visible color render pass with a cleared depth attachment. */
export function beginColorPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        clearValue: { r: 0.04, g: 0.06, b: 0.12, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
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
  pipeline: GPURenderPipeline,
): void {
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
        ],
      });
    }
    pass.setBindGroup(1, storage.bindGroup);
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    pass.setIndexBuffer(geometry.indexBuffer, "uint32");
    pass.drawIndexed(geometry.indexCount, call.instanceCount);
  }
}

/** Releases every part, storage, and depth resource owned by the draw path. */
export function destroyDrawResources(draw: DrawResources): void {
  for (const resource of draw.parts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
  }
  for (const storage of draw.storages.values()) {
    storage.buffer.destroy();
    storage.orderBuffer.destroy();
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
  if (existing !== undefined) {
    mirror.set(new Uint8Array(existing.data));
    orderData.set(existing.orderData.subarray(0, orderLength));
  }
  const storage: InstanceStorage = {
    buffer,
    orderBuffer,
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

/** Writes the changed contiguous byte ranges of a region into a GPU buffer. */
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
      device.queue.writeBuffer(
        buffer,
        baseOffset + rangeStart,
        next.subarray(rangeStart, rangeEnd),
      );
      rangeStart = -1;
    }
  }
}
