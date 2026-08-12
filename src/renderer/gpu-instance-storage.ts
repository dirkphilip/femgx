import type { ResolvedStyle } from "../interaction/interaction";
import { createHighlightStorage, type HighlightStorage } from "./gpu-highlight-storage";
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
 * Persistent per-part GPU storage: a slot-stable record buffer, compacted
 * opaque, transparent, edge-overlay, and node-annotation order buffers, and a
 * bounded-bucket emphasis buffer. Hidden instances stay in the record buffer
 * but are removed from the draw-order lists, so only visible geometry is ever
 * drawn. The edge order holds the subset of visible instances whose resolved
 * style requests the line-overlay pass.
 */
export interface InstanceStorage {
  readonly buffer: GPUBuffer;
  readonly orderBuffer: GPUBuffer;
  readonly transparentOrderBuffer: GPUBuffer;
  readonly edgeOrderBuffer: GPUBuffer;
  readonly nodeOrderBuffer: GPUBuffer;
  highlight: HighlightStorage;
  readonly capacity: number;
  /** CPU mirror of the record buffer, kept in sync by the patch functions. */
  data: ArrayBuffer;
  /** CPU mirror of the draw-order buffer. */
  orderData: Uint32Array;
  /** Number of meaningful draw-order entries. */
  orderLength: number;
  /** CPU mirror of the transparent draw-order buffer. */
  transparentOrderData: Uint32Array;
  /** Number of meaningful transparent draw-order entries. */
  transparentOrderLength: number;
  /** CPU mirror of the edge-overlay order buffer. */
  edgeOrderData: Uint32Array;
  /** Number of meaningful edge-overlay order entries. */
  edgeOrderLength: number;
  /** CPU mirror of the node-annotation order buffer. */
  nodeOrderData: Uint32Array;
  /** Number of meaningful node-annotation order entries. */
  nodeOrderLength: number;
  /** Cached bind group; invalidated whenever the storage buffers grow. */
  bindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the edge-order buffer; invalidated on growth. */
  edgeBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the transparent order buffer; invalidated on growth. */
  transparentBindGroup: GPUBindGroup | undefined;
}

interface InstanceStorageOwner {
  readonly device: GPUDevice;
  readonly storages: Map<number, InstanceStorage>;
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
  draw: InstanceStorageOwner,
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
export function writeDrawOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  storage.orderLength = writeOrderBuffer(
    draw.device,
    storage.orderBuffer,
    storage.orderData,
    order,
    storage.orderLength,
  );
}

/** Replaces the compacted transparent draw-order list of a part. */
export function writeTransparentOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  storage.transparentOrderLength = writeOrderBuffer(
    draw.device,
    storage.transparentOrderBuffer,
    storage.transparentOrderData,
    order,
    storage.transparentOrderLength,
  );
}

/**
 * Replaces the compacted edge-overlay order list of a part (visible instances
 * whose resolved style requests the line overlay). Like `writeDrawOrder`, only
 * the changed u32 subranges reach the GPU.
 */
export function writeEdgeOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  storage.edgeOrderLength = writeOrderBuffer(
    draw.device,
    storage.edgeOrderBuffer,
    storage.edgeOrderData,
    order,
    storage.edgeOrderLength,
  );
}

/** Replaces the compacted node-annotation order list of a part. */
export function writeNodeOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  storage.nodeOrderLength = writeOrderBuffer(
    draw.device,
    storage.nodeOrderBuffer,
    storage.nodeOrderData,
    order,
    storage.nodeOrderLength,
  );
}

/** Returns the existing per-part storage, creating or growing it as needed. */
function ensureStorage(
  draw: InstanceStorageOwner,
  partId: number,
  capacity: number,
): InstanceStorage {
  const existing = draw.storages.get(partId);
  if (existing !== undefined && existing.capacity >= capacity) return existing;
  const size = Math.max(capacity, existing === undefined ? 1 : existing.capacity * 2);
  const storage = createStorage(draw, size, existing);
  if (existing !== undefined) {
    copyStorageData(draw, existing, storage);
    destroyStorageBuffers(existing);
  }
  draw.storages.set(partId, storage);
  return storage;
}

function createStorage(
  draw: InstanceStorageOwner,
  size: number,
  existing: InstanceStorage | undefined,
): InstanceStorage {
  const mirror = new Uint8Array(size * INSTANCE_STRIDE);
  const orderLength = existing?.orderLength ?? 0;
  const transparentOrderLength = existing?.transparentOrderLength ?? 0;
  const edgeOrderLength = existing?.edgeOrderLength ?? 0;
  const nodeOrderLength = existing?.nodeOrderLength ?? 0;
  return {
    buffer: draw.device.createBuffer({
      size: size * INSTANCE_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    orderBuffer: createOrderBuffer(draw.device, size),
    transparentOrderBuffer: createOrderBuffer(draw.device, size),
    edgeOrderBuffer: createOrderBuffer(draw.device, size),
    nodeOrderBuffer: createOrderBuffer(draw.device, size),
    highlight: existing?.highlight ?? createHighlightStorage(draw.device),
    capacity: size,
    data: mirror.buffer,
    orderData: new Uint32Array(size),
    orderLength,
    transparentOrderData: new Uint32Array(size),
    transparentOrderLength,
    edgeOrderData: new Uint32Array(size),
    edgeOrderLength,
    nodeOrderData: new Uint32Array(size),
    nodeOrderLength,
    bindGroup: undefined,
    edgeBindGroup: undefined,
    transparentBindGroup: undefined,
  };
}

function copyStorageData(
  draw: InstanceStorageOwner,
  existing: InstanceStorage,
  storage: InstanceStorage,
): void {
  new Uint8Array(storage.data).set(new Uint8Array(existing.data));
  storage.orderData.set(existing.orderData.subarray(0, existing.orderLength));
  storage.transparentOrderData.set(
    existing.transparentOrderData.subarray(0, existing.transparentOrderLength),
  );
  storage.edgeOrderData.set(existing.edgeOrderData.subarray(0, existing.edgeOrderLength));
  storage.nodeOrderData.set(existing.nodeOrderData.subarray(0, existing.nodeOrderLength));
  draw.device.queue.writeBuffer(storage.buffer, 0, storage.data);
  writeExistingOrder(draw, storage.orderBuffer, storage.orderData, existing.orderLength);
  writeExistingOrder(
    draw,
    storage.transparentOrderBuffer,
    storage.transparentOrderData,
    existing.transparentOrderLength,
  );
  writeExistingOrder(
    draw,
    storage.edgeOrderBuffer,
    storage.edgeOrderData,
    existing.edgeOrderLength,
  );
  writeExistingOrder(
    draw,
    storage.nodeOrderBuffer,
    storage.nodeOrderData,
    existing.nodeOrderLength,
  );
}

function writeExistingOrder(
  draw: InstanceStorageOwner,
  buffer: GPUBuffer,
  data: Uint32Array,
  length: number,
): void {
  if (length > 0) draw.device.queue.writeBuffer(buffer, 0, data.subarray(0, length));
}

function destroyStorageBuffers(storage: InstanceStorage): void {
  storage.buffer.destroy();
  storage.orderBuffer.destroy();
  storage.transparentOrderBuffer.destroy();
  storage.edgeOrderBuffer.destroy();
  storage.nodeOrderBuffer.destroy();
}

/** Creates a u32 storage buffer sized to the part's slot capacity. */
function createOrderBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size: size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
