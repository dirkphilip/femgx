import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { InstanceId } from "../scene/types";
import {
  buildHighlightTable,
  BODY_HIGHLIGHT_MARKER,
  HIGHLIGHT_BUCKET_SIZE,
  type HighlightTableEntry,
} from "./gpu-highlight-table";
import {
  collectEmphasisUpdates,
  encodeEmphasisRecord,
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
  type EmphasisUpdate,
} from "./gpu-elements";
import type { GpuCostAccumulator } from "./gpu-cost";
import { writeChangedRecordRanges } from "./gpu-writes";

interface InstanceLayout {
  readonly slotPartLocal: Int32Array;
}

/** A GPU highlight buffer plus its full CPU mirror for diffed writes. */
export interface HighlightStorage {
  readonly buffer: GPUBuffer;
  data: Uint8Array<ArrayBuffer>;
}

/** Creates a highlight buffer sized for `capacity` emphasis records. */
export function createHighlightStorage(
  device: GPUDevice,
  capacity = INITIAL_ELEMENT_HIGHLIGHTS,
): HighlightStorage {
  const size = HIGHLIGHT_HEADER + capacity * ELEMENT_RECORD_STRIDE;
  const buffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return { buffer, data: new Uint8Array(size) };
}

/** Writes the changed header and fixed-size emphasis record ranges. */
export function writeElementHighlights(
  device: GPUDevice,
  storage: HighlightTarget,
  updates: readonly EmphasisUpdate[],
  cost?: GpuCostAccumulator,
): void {
  const entries = updates.map(toTableEntry);
  const table = buildHighlightTable(entries);
  ensureHighlightStorage(device, storage, table.entries.length, cost);
  const next = new Uint8Array(storage.highlight.data.length);
  const view = new Uint32Array(next.buffer);
  view[0] = entries.length;
  view[1] = table.bucketCount;
  view[2] = table.seed;
  for (let index = 0; index < table.entries.length; index += 1) {
    const entry = table.entries[index];
    if (entry === undefined) continue;
    next.set(new Uint8Array(entry.data), HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE);
  }
  writeChangedRanges(device, storage, next, table.bucketCount, cost);
  storage.highlight.data.set(next);
}

function writeChangedRanges(
  device: GPUDevice,
  storage: HighlightTarget,
  next: Uint8Array,
  bucketCount: number,
  cost?: GpuCostAccumulator,
): void {
  const previous = storage.highlight.data;
  const previousView = new Uint32Array(previous.buffer);
  const previousSlots = (previousView[1] ?? 0) * HIGHLIGHT_BUCKET_SIZE;
  const nextSlots = bucketCount * HIGHLIGHT_BUCKET_SIZE;
  const header = next.subarray(0, HIGHLIGHT_HEADER);
  const previousHeader = previous.subarray(0, HIGHLIGHT_HEADER);
  if (header.some((value, index) => value !== previousHeader[index])) {
    device.queue.writeBuffer(storage.highlight.buffer, 0, header);
    cost?.write("highlight", HIGHLIGHT_HEADER);
  }
  const recordCount = Math.max(previousSlots, nextSlots);
  const changedRecords: number[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    if (recordChanged(next, previous, index)) changedRecords.push(index);
  }
  writeChangedRecordRanges(device, {
    buffer: storage.highlight.buffer,
    next,
    recordOffset: HIGHLIGHT_HEADER,
    recordStride: ELEMENT_RECORD_STRIDE,
    recordIndices: changedRecords,
    cost,
    category: "highlight",
  });
}

function recordChanged(next: Uint8Array, previous: Uint8Array, index: number): boolean {
  const start = HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE;
  for (let offset = 0; offset < ELEMENT_RECORD_STRIDE; offset += 1) {
    if (next[start + offset] !== previous[start + offset]) return true;
  }
  return false;
}

function ensureHighlightStorage(
  device: GPUDevice,
  storage: HighlightTarget,
  minimumRecords: number,
  cost?: GpuCostAccumulator,
): void {
  const highlight = storage.highlight;
  const capacity = highlightCapacity(highlight.data.byteLength);
  if (minimumRecords <= capacity) return;
  const nextCapacity = Math.max(minimumRecords, capacity * 2);
  const grown = createHighlightStorage(device, nextCapacity);
  grown.data.set(highlight.data);
  device.queue.writeBuffer(grown.buffer, 0, grown.data);
  cost?.write("highlight", grown.data.byteLength);
  highlight.buffer.destroy();
  storage.highlight = grown;
  storage.bindGroup = undefined;
  storage.edgeBindGroup = undefined;
  storage.transparentBindGroup = undefined;
  storage.selectionBindGroup = undefined;
  storage.nodeSelectionBindGroup = undefined;
}

function highlightCapacity(byteLength: number): number {
  return (byteLength - HIGHLIGHT_HEADER) / ELEMENT_RECORD_STRIDE;
}

function toTableEntry(update: EmphasisUpdate): HighlightTableEntry {
  const bodyPickId = update.bodyPickId ?? 0;
  return {
    slot: update.slot,
    elementPickId: bodyPickId === 0 ? update.elementPickId : bodyPickId,
    facePickId: bodyPickId === 0 ? update.facePickId : BODY_HIGHLIGHT_MARKER,
    nodePickId: update.nodePickId,
    data: encodeEmphasisRecord(update),
  };
}

/** The draw-path inputs needed to sync emphasis buffers. */
export interface ElementHighlightSync {
  readonly device: GPUDevice;
  readonly draw: {
    readonly storages: ReadonlyMap<PartId, HighlightTarget>;
    readonly cost: GpuCostAccumulator;
  };
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
  readonly parts: ReadonlyMap<PartId, Part>;
}

interface HighlightTarget {
  highlight: HighlightStorage;
  bindGroup: GPUBindGroup | undefined;
  edgeBindGroup: GPUBindGroup | undefined;
  transparentBindGroup: GPUBindGroup | undefined;
  selectionBindGroup: GPUBindGroup | undefined;
  nodeSelectionBindGroup: GPUBindGroup | undefined;
}

/** Recomputes every part's emphasis table and writes only changed ranges. */
export function syncElementHighlights(
  sync: ElementHighlightSync,
  interaction: InteractionState,
  affectedParts?: ReadonlySet<PartId>,
): void {
  const updates = collectEmphasisUpdates(
    sync.runtime,
    sync.layout,
    sync.slotByInstanceId,
    sync.parts,
    interaction,
  );
  for (const [partId, storage] of sync.draw.storages) {
    if (affectedParts !== undefined && !affectedParts.has(partId)) continue;
    writeElementHighlights(sync.device, storage, updates.get(partId) ?? [], sync.draw.cost);
  }
}
