import { writeChangedRecordRanges, writeOrderBuffer } from "./buffer-writes";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { HighlightStorage } from "../selection/highlight-storage";
import { createOrderBuffer, invalidateBindGroups as clearBindGroups } from "./foundation";
import {
  INSTANCE_EDGE_EMPHASIS_FLAG,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_STRIDE,
} from "./instance-record";
import {
  captureStagedInstanceRecord,
  captureStagedOrderValue,
  type InstanceStorageRevisionJournal,
} from "./instance-storage/journal";
import { createStorageBuffers } from "./instance-storage/create-storage-buffers";
import type { BufferWritePort } from "./buffer-write-port";

export {
  captureStagedInstanceRecord,
  createInstanceStorageRevisionJournal,
  rollbackStagedInstanceStorage,
  type InstanceStorageRevisionJournal,
} from "./instance-storage/journal";

export {
  createInstanceRecordTarget,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  INSTANCE_EDGE_EMPHASIS_FLAG,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_RESULT_COLOR_FLAG,
  INSTANCE_SELECTED_FLAG,
  INSTANCE_STRIDE,
  LINE_WIDTH_BYTE_OFFSET,
  writeInstanceRecord,
  type InstanceRecordTarget,
  type InstanceRecordValues,
} from "./instance-record";
export { createEmptyOrderBuffer, invalidateBindGroups, orderBufferFor } from "./foundation";

/** One pre-encoded instance record written into a per-part buffer. */
export interface InstanceUpdate {
  /** Part-local slot index (stable across visibility changes). */
  readonly slot: number;
  /** `INSTANCE_STRIDE`-byte encoded transform/style/pick record. */
  readonly data: ArrayBuffer;
}

/** One compacted optional order list and its CPU mirror. */
export interface InstanceOrderStorage {
  readonly buffer: GPUBuffer;
  readonly data: Uint32Array;
  readonly capacity: number;
  length: number;
}

/** Optional presentation and interaction storage admitted for one part. */
export interface InstanceSidecars {
  transparent: InstanceOrderStorage | undefined;
  selection: InstanceOrderStorage | undefined;
  nodeSelection: InstanceOrderStorage | undefined;
  nodeSelectionCompact: InstanceOrderStorage | undefined;
  edge: InstanceOrderStorage | undefined;
  node: InstanceOrderStorage | undefined;
}

/**
 * Persistent per-part GPU storage: a slot-stable record buffer and compacted
 * ordinary visible order. Hidden instances stay in the record buffer but are
 * removed from that order, so only visible geometry is ever drawn. Transparent,
 * selection, edge, node, and emphasis resources are explicit sidecars admitted
 * by their active state and bound to fixed device sentinels while inactive.
 */
export interface InstanceStorage {
  readonly buffer: GPUBuffer;
  readonly orderBuffer: GPUBuffer;
  /** Device-scoped valid binding used by inactive order sidecars. */
  readonly emptyOrderBuffer: GPUBuffer;
  /** Device-scoped zero-entry emphasis binding used while inactive. */
  readonly emptyHighlight: HighlightStorage;
  /** Revision-local storage keeps replaced live sidecars alive until commit. */
  readonly deferRelease?: boolean;
  /** Exact CPU-mirror mutations made while a definition revision is staged. */
  readonly revisionJournal?: InstanceStorageRevisionJournal;
  readonly sidecars: InstanceSidecars;
  highlight: HighlightStorage;
  /** True when `highlight` is a part-owned optional allocation. */
  highlightOwned: boolean;
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
  /** Cached bind group; invalidated whenever the storage buffers grow. */
  bindGroup: GPUBindGroup | undefined;
  /** Cached minimal-layout bind group for ordinary opaque triangles. */
  minimalBindGroup: GPUBindGroup | undefined;
  /** Cached minimal-layout bind group for ordinary transparent triangles. */
  minimalTransparentBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing node-sprite geometry and its node-id table. */
  nodeBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the edge-order buffer; invalidated on growth. */
  edgeBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the transparent order buffer; invalidated on growth. */
  transparentBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the selection order buffer; invalidated on growth. */
  selectionBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing selected instances and face-subset geometry. */
  subsetSelectionBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the selected-node order buffer. */
  nodeSelectionBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing compact selected-node occurrence/id sidecars. */
  nodeSelectionCompactBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing the face-subset opaque/pick geometry. */
  subsetBindGroup: GPUBindGroup | undefined;
  /** Cached bind group addressing transparent face-subset geometry. */
  subsetTransparentBindGroup: GPUBindGroup | undefined;
}

export interface InstanceStorageOwner {
  readonly device: GPUDevice;
  readonly writePort: BufferWritePort;
  readonly cost: GpuCostAccumulator;
  readonly storages: Map<number, InstanceStorage>;
  readonly emptyOrderBuffer: GPUBuffer;
  readonly emptyHighlight: HighlightStorage;
  readonly deferReleases?: boolean;
}

type OrderKind = "draw" | keyof InstanceSidecars;

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
    if (!sameRecord(next, offset, data)) {
      changedSlots.push(slot);
      captureStagedInstanceRecord(storage, slot);
      next.set(data, offset);
    }
  }
  writeChangedRecordRanges(draw.writePort, {
    buffer: storage.buffer,
    next,
    recordOffset: 0,
    recordStride: INSTANCE_STRIDE,
    recordIndices: changedSlots,
    cost: draw.cost,
    category: "instance",
  });
}

/**
 * Owns the exact mirrors and initial uploads for one newly attached part. The
 * cold attachment path has already established slot uniqueness and ordering,
 * so it does not need the incremental patcher's copy, merge, or sort work.
 */
export function initializeInstancePart(
  draw: InstanceStorageOwner,
  partId: number,
  data: ArrayBuffer,
  orderData: Uint32Array,
  orderLength: number,
): void {
  const capacity = data.byteLength / INSTANCE_STRIDE;
  const storage = createStorage(draw, capacity, undefined, { data, orderData, orderLength });
  draw.storages.set(partId, storage);
  draw.writePort.writeBuffer(storage.buffer, 0, data);
  draw.cost.write("instance", data.byteLength);
  if (orderLength > 0) {
    const order = orderData.subarray(0, orderLength);
    draw.writePort.writeBuffer(storage.orderBuffer, 0, order);
    draw.cost.write("order", order.byteLength);
  }
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

/** Replaces paired sparse selected-node occurrence and authored-node orders. */
export function writeSelectedNodeCompactOrder(
  draw: InstanceStorageOwner,
  partId: number,
  occurrences: Uint32Array,
  nodeIds: Uint32Array,
): void {
  if (occurrences.length !== nodeIds.length) {
    throw new Error("Selected-node occurrence and id orders must have equal length");
  }
  const order = new Uint32Array(occurrences.length * 2);
  for (let index = 0; index < occurrences.length; index += 1) {
    const offset = index * 2;
    order[offset] = occurrences[index] ?? 0;
    order[offset + 1] = nodeIds[index] ?? 0;
  }
  writeOrder(draw, partId, order, "nodeSelectionCompact");
}

/**
 * Replaces the compacted edge-overlay order list of a part. Like
 * `writeDrawOrder`, only the changed u32 subranges reach the GPU.
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
  const storage = ensureStorage(draw, partId, kind === "draw" ? Math.max(1, order.length) : 1);
  if (kind === "draw") {
    storage.orderLength = writeOrderBuffer(
      draw.writePort,
      storage.orderBuffer,
      storage.orderData,
      order,
      {
        previousLength: storage.orderLength,
        cost: draw.cost,
        capture: (index) => {
          captureStagedOrderValue(storage, storage.orderData, index);
        },
      },
    );
    return;
  }
  if (order.length === 0) {
    releaseOrderSidecar(draw, storage, kind);
    return;
  }
  const sidecar = ensureOrderSidecar(draw, storage, kind, order.length);
  sidecar.length = writeOrderBuffer(draw.writePort, sidecar.buffer, sidecar.data, order, {
    previousLength: sidecar.length,
    cost: draw.cost,
    capture: (index) => {
      captureStagedOrderValue(storage, sidecar.data, index);
    },
  });
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
    copyCoreData(draw, existing, storage);
    destroyCoreBuffers(draw, existing);
    draw.cost.invalidateBindGroups();
  }
  draw.storages.set(partId, storage);
  return storage;
}

function createStorage(
  draw: InstanceStorageOwner,
  size: number,
  existing: InstanceStorage | undefined,
  initial?: {
    readonly data: ArrayBuffer;
    readonly orderData: Uint32Array;
    readonly orderLength: number;
  },
): InstanceStorage {
  const mirror = initial?.data ?? new ArrayBuffer(size * INSTANCE_STRIDE);
  const { buffer, orderBuffer } = createStorageBuffers({
    device: draw.device,
    cost: draw.cost,
    size: size * INSTANCE_STRIDE,
    createOrderBuffer: () => createOrderBuffer(draw.device, size, "femgx instance order"),
  });
  const storage: InstanceStorage = {
    buffer,
    orderBuffer,
    emptyOrderBuffer: draw.emptyOrderBuffer,
    emptyHighlight: draw.emptyHighlight,
    sidecars: existing?.sidecars ?? {
      transparent: undefined,
      selection: undefined,
      nodeSelection: undefined,
      nodeSelectionCompact: undefined,
      edge: undefined,
      node: undefined,
    },
    highlight: existing?.highlight ?? draw.emptyHighlight,
    highlightOwned: existing?.highlightOwned ?? false,
    capacity: size,
    data: mirror,
    emphasisSlots: new Set(existing?.emphasisSlots),
    edgeEmphasisSlots: new Set(existing?.edgeEmphasisSlots),
    orderData: initial?.orderData ?? new Uint32Array(size),
    orderLength: initial?.orderLength ?? existing?.orderLength ?? 0,
    bindGroup: undefined,
    minimalBindGroup: undefined,
    minimalTransparentBindGroup: undefined,
    nodeBindGroup: undefined,
    edgeBindGroup: undefined,
    transparentBindGroup: undefined,
    selectionBindGroup: undefined,
    subsetSelectionBindGroup: undefined,
    nodeSelectionBindGroup: undefined,
    nodeSelectionCompactBindGroup: undefined,
    subsetBindGroup: undefined,
    subsetTransparentBindGroup: undefined,
  };
  draw.cost.allocateBuffer(storage.buffer.size);
  draw.cost.allocateBuffer(storage.orderBuffer.size);
  return storage;
}

function copyCoreData(
  draw: InstanceStorageOwner,
  existing: InstanceStorage,
  storage: InstanceStorage,
): void {
  new Uint8Array(storage.data).set(new Uint8Array(existing.data));
  storage.orderData.set(existing.orderData.subarray(0, existing.orderLength));
  draw.writePort.writeBuffer(storage.buffer, 0, storage.data);
  draw.cost.write("instance", storage.data.byteLength);
  writeExistingOrder(draw, storage.orderBuffer, storage.orderData, existing.orderLength);
}

function writeExistingOrder(
  draw: InstanceStorageOwner,
  buffer: GPUBuffer,
  data: Uint32Array,
  length: number,
): void {
  if (length > 0) {
    const bytes = data.subarray(0, length);
    draw.writePort.writeBuffer(buffer, 0, bytes);
    draw.cost.write("order", bytes.byteLength);
  }
}

function destroyCoreBuffers(draw: InstanceStorageOwner, storage: InstanceStorage): void {
  if (draw.deferReleases) return;
  draw.cost.releaseBuffer(storage.buffer.size);
  draw.cost.releaseBuffer(storage.orderBuffer.size);
  storage.buffer.destroy();
  storage.orderBuffer.destroy();
}

function ensureOrderSidecar(
  draw: InstanceStorageOwner,
  storage: InstanceStorage,
  kind: keyof InstanceSidecars,
  minimumCapacity: number,
): InstanceOrderStorage {
  const existing = storage.sidecars[kind];
  if (existing !== undefined && existing.capacity >= minimumCapacity) return existing;
  const capacity = Math.max(minimumCapacity, (existing?.capacity ?? 0) * 2 || 1);
  const next: InstanceOrderStorage = {
    buffer: createOrderBuffer(draw.device, capacity, `femgx ${kind} order`),
    data: new Uint32Array(capacity),
    capacity,
    length: existing?.length ?? 0,
  };
  if (existing !== undefined) {
    next.data.set(existing.data.subarray(0, existing.length));
    writeExistingOrder(draw, next.buffer, next.data, existing.length);
    releaseOrderBuffer(draw, existing.buffer);
  }
  draw.cost.allocateBuffer(next.buffer.size);
  storage.sidecars[kind] = next;
  clearBindGroups(storage, draw.cost);
  return next;
}

function releaseOrderSidecar(
  draw: InstanceStorageOwner,
  storage: InstanceStorage,
  kind: keyof InstanceSidecars,
): void {
  const sidecar = storage.sidecars[kind];
  if (sidecar === undefined) return;
  releaseOrderBuffer(draw, sidecar.buffer);
  storage.sidecars[kind] = undefined;
  clearBindGroups(storage, draw.cost);
}

function releaseOrderBuffer(draw: InstanceStorageOwner, buffer: GPUBuffer): void {
  if (draw.deferReleases) return;
  draw.cost.releaseBuffer(buffer.size);
  buffer.destroy();
}
