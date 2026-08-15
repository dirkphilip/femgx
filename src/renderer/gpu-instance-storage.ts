import type { ResolvedStyle } from "../interaction/interaction";
import { createHighlightStorage, type HighlightStorage } from "./gpu-highlight-storage";
import { writeChangedRecordRanges, writeOrderBuffer } from "./gpu-writes";
import type { GpuCostAccumulator } from "./gpu-cost";

/** Byte size of one instance record in the per-part storage buffer. */
export const INSTANCE_STRIDE = 96;

/** Bit flags packed into the instance record's selected word. */
export const INSTANCE_SELECTED_FLAG = 1;
export const INSTANCE_EMPHASIS_FLAG = 2;
export const INSTANCE_EDGE_EMPHASIS_FLAG = 4;

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
 * | 88     | 4    | selected/emphasis flags (`u32`) |
 * | 92     | 4    | line width (`f32`) |
 */
export const EMISSIVE_BYTE_OFFSET = 84;
/** Byte offset of the resolved authored line width in CSS pixels. */
export const LINE_WIDTH_BYTE_OFFSET = 92;

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
  readonly selectionOrderBuffer: GPUBuffer;
  readonly nodeSelectionOrderBuffer: GPUBuffer;
  readonly transparentOrderBuffer: GPUBuffer;
  readonly edgeOrderBuffer: GPUBuffer;
  readonly nodeOrderBuffer: GPUBuffer;
  highlight: HighlightStorage;
  readonly capacity: number;
  /** CPU mirror of the record buffer, kept in sync by the patch functions. */
  data: ArrayBuffer;
  /** Part-local slots with at least one primitive emphasis record. */
  emphasisSlots: Set<number>;
  /** Part-local slots with at least one emphasized authored edge. */
  edgeEmphasisSlots: Set<number>;
  /** CPU mirror of the draw-order buffer. */
  orderData: Uint32Array;
  /** Number of meaningful draw-order entries. */
  orderLength: number;
  /** CPU mirror of the selected-instance draw-order buffer. */
  readonly selectionOrderData: Uint32Array;
  /** Number of meaningful selected-instance draw-order entries. */
  selectionOrderLength: number;
  /** CPU mirror of the selected-node draw-order buffer. */
  readonly nodeSelectionOrderData: Uint32Array;
  /** Number of meaningful selected-node draw-order entries. */
  nodeSelectionOrderLength: number;
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
  /** Cached bind group addressing node-sprite geometry and its node-id table. */
  nodeBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the edge-order buffer; invalidated on growth. */
  edgeBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the transparent order buffer; invalidated on growth. */
  transparentBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the selection order buffer; invalidated on growth. */
  selectionBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the selected-node order buffer. */
  nodeSelectionBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the face-subset opaque/pick geometry. */
  subsetBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing transparent face-subset geometry. */
  subsetTransparentBindGroup: GPUBindGroup | undefined;
}

interface InstanceStorageOwner {
  readonly device: GPUDevice;
  readonly cost: GpuCostAccumulator;
  readonly storages: Map<number, InstanceStorage>;
}

type OrderKind = "draw" | "transparent" | "selection" | "nodeSelection" | "edge" | "node";

const orderFields = {
  draw: { buffer: "orderBuffer", data: "orderData", length: "orderLength" },
  transparent: {
    buffer: "transparentOrderBuffer",
    data: "transparentOrderData",
    length: "transparentOrderLength",
  },
  selection: {
    buffer: "selectionOrderBuffer",
    data: "selectionOrderData",
    length: "selectionOrderLength",
  },
  nodeSelection: {
    buffer: "nodeSelectionOrderBuffer",
    data: "nodeSelectionOrderData",
    length: "nodeSelectionOrderLength",
  },
  edge: { buffer: "edgeOrderBuffer", data: "edgeOrderData", length: "edgeOrderLength" },
  node: { buffer: "nodeOrderBuffer", data: "nodeOrderData", length: "nodeOrderLength" },
} as const satisfies Record<
  OrderKind,
  {
    readonly buffer: keyof InstanceStorage;
    readonly data: keyof InstanceStorage;
    readonly length: keyof InstanceStorage;
  }
>;

/**
 * Encodes one instance record: column-major world transform, resolved color
 * (with opacity folded into alpha), a stable pick id derived from the
 * instance slot, and the resolved emissive used for hover/highlight glow.
 */
export function encodeInstanceRecord(
  transform: Float32Array,
  style: ResolvedStyle,
  pickId: number,
  selected = false,
): ArrayBuffer {
  const data = new ArrayBuffer(INSTANCE_STRIDE);
  const floats = new Float32Array(data);
  new Uint32Array(data)[20] = pickId;
  floats.set(transform, 0);
  floats.set([style.color.r, style.color.g, style.color.b, style.color.a * style.opacity], 16);
  floats[EMISSIVE_BYTE_OFFSET / 4] = style.emissive;
  new Uint32Array(data)[22] = selected ? INSTANCE_SELECTED_FLAG : 0;
  floats[LINE_WIDTH_BYTE_OFFSET / 4] = style.lineWidthPixels;
  return data;
}

/**
 * Writes changed fixed-size records, coalescing adjacent slots into one upload
 * range without scanning the byte span between distant updates.
 */
export function patchInstances(
  draw: InstanceStorageOwner,
  partId: number,
  updates: readonly InstanceUpdate[],
): void {
  if (updates.length === 0) return;
  const bySlot = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const update of updates) bySlot.set(update.slot, new Uint8Array(update.data.slice(0)));
  const slots = [...bySlot.keys()].sort((left, right) => left - right);
  const lastSlot = slots[slots.length - 1];
  if (lastSlot === undefined) return;
  const storage = ensureStorage(draw, partId, lastSlot + 1);
  const next = new Uint8Array(storage.data);
  const currentFlags = new Uint32Array(storage.data);
  const changedSlots: number[] = [];
  for (const slot of slots) {
    const data = bySlot.get(slot);
    if (data === undefined) continue;
    const offset = slot * INSTANCE_STRIDE;
    const word = offset / 4 + 22;
    const dataFlags = new Uint32Array(data.buffer);
    dataFlags[22] =
      (dataFlags[22] ?? 0) |
      ((currentFlags[word] ?? 0) & (INSTANCE_EMPHASIS_FLAG | INSTANCE_EDGE_EMPHASIS_FLAG));
    if (!sameRecord(next, offset, data)) changedSlots.push(slot);
    next.set(data, offset);
  }
  writeChangedRecordRanges(draw.device, {
    buffer: storage.buffer,
    next,
    recordOffset: 0,
    recordStride: INSTANCE_STRIDE,
    recordIndices: changedSlots,
    cost: draw.cost,
    category: "instance",
  });
}

function sameRecord(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  next: Uint8Array<ArrayBuffer>,
): boolean {
  for (let index = 0; index < INSTANCE_STRIDE; index += 1) {
    if (bytes[offset + index] !== next[index]) return false;
  }
  return true;
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
  writeOrder(draw, partId, order, "draw");
}

/** Replaces the compacted transparent draw-order list of a part. */
export function writeTransparentOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  writeOrder(draw, partId, order, "transparent");
}

/** Replaces the compacted selected-instance draw-order list of a part. */
export function writeSelectionOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  writeOrder(draw, partId, order, "selection");
}

/** Replaces the compacted selected-node-instance draw-order list of a part. */
export function writeNodeSelectionOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  writeOrder(draw, partId, order, "nodeSelection");
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
  writeOrder(draw, partId, order, "edge");
}

/** Replaces the compacted node-annotation order list of a part. */
export function writeNodeOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
): void {
  writeOrder(draw, partId, order, "node");
}

function writeOrder(
  draw: InstanceStorageOwner,
  partId: number,
  order: Uint32Array,
  kind: OrderKind,
): void {
  const storage = ensureStorage(draw, partId, Math.max(1, order.length));
  const fields = orderFields[kind];
  storage[fields.length] = writeOrderBuffer(
    draw.device,
    storage[fields.buffer],
    storage[fields.data],
    order,
    { previousLength: storage[fields.length], cost: draw.cost },
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
    selectionOrderBuffer: createOrderBuffer(draw.device, size),
    nodeSelectionOrderBuffer: createOrderBuffer(draw.device, size),
    transparentOrderBuffer: createOrderBuffer(draw.device, size),
    edgeOrderBuffer: createOrderBuffer(draw.device, size),
    nodeOrderBuffer: createOrderBuffer(draw.device, size),
    highlight: existing?.highlight ?? createHighlightStorage(draw.device),
    capacity: size,
    data: mirror.buffer,
    emphasisSlots: new Set(existing?.emphasisSlots),
    edgeEmphasisSlots: new Set(existing?.edgeEmphasisSlots),
    orderData: new Uint32Array(size),
    orderLength,
    selectionOrderData: new Uint32Array(size),
    selectionOrderLength: existing?.selectionOrderLength ?? 0,
    nodeSelectionOrderData: new Uint32Array(size),
    nodeSelectionOrderLength: existing?.nodeSelectionOrderLength ?? 0,
    transparentOrderData: new Uint32Array(size),
    transparentOrderLength,
    edgeOrderData: new Uint32Array(size),
    edgeOrderLength,
    nodeOrderData: new Uint32Array(size),
    nodeOrderLength,
    bindGroup: undefined,
    nodeBindGroup: undefined,
    edgeBindGroup: undefined,
    transparentBindGroup: undefined,
    selectionBindGroup: undefined,
    nodeSelectionBindGroup: undefined,
    subsetBindGroup: undefined,
    subsetTransparentBindGroup: undefined,
  };
}

function copyStorageData(
  draw: InstanceStorageOwner,
  existing: InstanceStorage,
  storage: InstanceStorage,
): void {
  new Uint8Array(storage.data).set(new Uint8Array(existing.data));
  storage.orderData.set(existing.orderData.subarray(0, existing.orderLength));
  storage.selectionOrderData.set(
    existing.selectionOrderData.subarray(0, existing.selectionOrderLength),
  );
  storage.nodeSelectionOrderData.set(
    existing.nodeSelectionOrderData.subarray(0, existing.nodeSelectionOrderLength),
  );
  storage.transparentOrderData.set(
    existing.transparentOrderData.subarray(0, existing.transparentOrderLength),
  );
  storage.edgeOrderData.set(existing.edgeOrderData.subarray(0, existing.edgeOrderLength));
  storage.nodeOrderData.set(existing.nodeOrderData.subarray(0, existing.nodeOrderLength));
  draw.device.queue.writeBuffer(storage.buffer, 0, storage.data);
  draw.cost.write("instance", storage.data.byteLength);
  writeExistingOrder(draw, storage.orderBuffer, storage.orderData, existing.orderLength);
  writeExistingOrder(
    draw,
    storage.selectionOrderBuffer,
    storage.selectionOrderData,
    existing.selectionOrderLength,
  );
  writeExistingOrder(
    draw,
    storage.nodeSelectionOrderBuffer,
    storage.nodeSelectionOrderData,
    existing.nodeSelectionOrderLength,
  );
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
  if (length > 0) {
    const bytes = data.subarray(0, length);
    draw.device.queue.writeBuffer(buffer, 0, bytes);
    draw.cost.write("order", bytes.byteLength);
  }
}

function destroyStorageBuffers(storage: InstanceStorage): void {
  storage.buffer.destroy();
  storage.orderBuffer.destroy();
  storage.selectionOrderBuffer.destroy();
  storage.nodeSelectionOrderBuffer.destroy();
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
