import type { ResolvedStyle } from "../interaction/interaction";
import { createHighlightStorage, type HighlightStorage } from "./gpu-elements";
import type { DrawResources } from "./gpu-draw";
import { writeDiffedRange, writeOrderBuffer } from "./gpu-writes";

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

/**
 * Persistent per-part GPU storage: a slot-stable record buffer, a compacted
 * draw-order buffer, a compacted edge-overlay order buffer, and a
 * bounded-bucket emphasis buffer. Hidden instances stay in the record buffer
 * but are removed from the draw-order lists, so only visible geometry is ever
 * drawn. The edge order holds the subset of visible instances whose resolved
 * style requests the line-overlay pass.
 */
export interface InstanceStorage {
  readonly buffer: GPUBuffer;
  readonly orderBuffer: GPUBuffer;
  readonly edgeOrderBuffer: GPUBuffer;
  highlight: HighlightStorage;
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
  partId: number,
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
export function writeDrawOrder(draw: DrawResources, partId: number, order: Uint32Array): void {
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
export function writeEdgeOrder(draw: DrawResources, partId: number, order: Uint32Array): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  storage.edgeOrderLength = writeOrderBuffer(
    draw.device,
    storage.edgeOrderBuffer,
    storage.edgeOrderData,
    order,
    storage.edgeOrderLength,
  );
}

/** Returns the existing per-part storage, creating or growing it as needed. */
function ensureStorage(draw: DrawResources, partId: number, capacity: number): InstanceStorage {
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
