import type { Part } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PartId } from "../../geometry/part";
import type { InstanceId } from "../../scene/types";
import {
  buildHighlightTable,
  BODY_HIGHLIGHT_MARKER,
  EDGE_HIGHLIGHT_MARKER,
  type HighlightTableEntry,
} from "./highlight-table";
import {
  collectEmphasisUpdates,
  encodeEmphasisRecord,
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
  type EmphasisUpdate,
  type EmphasisUpdates,
} from "../resources/element-resources";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import { writeChangedRecordRanges } from "../resources/buffer-writes";
import type {
  DenseElementLayout,
  DenseElementSelection,
  DenseElementSelections,
} from "./element-selection";
import { collectDenseElementSelections } from "./element-selection";
import {
  highlightByteLength,
  writeDenseSelectionBuffer,
  writeDenseSelectionData,
  writeSelectionHeader,
} from "./highlight-selection-storage";
import { readInteractionState } from "../../interaction/state";
import type { PrimitiveStyleOverride } from "../../interaction/interaction";
import { sparseUpdatesForPart } from "./highlight-filter";

const ZERO_RECORD = new Uint8Array(ELEMENT_RECORD_STRIDE);

/** A GPU highlight buffer plus its full CPU mirror for diffed writes. */
export interface HighlightStorage {
  readonly buffer: GPUBuffer;
  data: Uint8Array<ArrayBuffer>;
  sparseCapacity: number;
  selectionSlotCapacity: number;
  selectionRecordCapacity: number;
  selectionWordCapacity: number;
  denseSelection: DenseElementSelection | undefined;
}

/** Creates a highlight buffer sized for `capacity` emphasis records. */
export function createHighlightStorage(
  device: GPUDevice,
  capacity = INITIAL_ELEMENT_HIGHLIGHTS,
  selectionSlotCapacity = 0,
  selectionRecordCapacity = 0,
  selectionWordCapacity = 0,
): HighlightStorage {
  const size = highlightByteLength(
    capacity,
    selectionSlotCapacity,
    selectionRecordCapacity,
    selectionWordCapacity,
  );
  const buffer = device.createBuffer({
    label: "femgx element highlight storage",
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return {
    buffer,
    data: new Uint8Array(size),
    sparseCapacity: capacity,
    selectionSlotCapacity,
    selectionRecordCapacity,
    selectionWordCapacity,
    denseSelection: undefined,
  };
}

interface HighlightWriteOptions {
  readonly cost?: GpuCostAccumulator;
  readonly selection?: DenseElementSelection | undefined;
  readonly selectedTheme?: PrimitiveStyleOverride | undefined;
  readonly slotCapacity?: number;
}

/** Writes the changed header and fixed-size emphasis record ranges. */
export function writeElementHighlights(
  device: GPUDevice,
  storage: HighlightTarget,
  updates: readonly EmphasisUpdate[],
  options: HighlightWriteOptions = {},
): void {
  const entries = updates.map(toTableEntry);
  const table = buildHighlightTable(entries);
  const selection = options.selection;
  if (table.entries.length === 0 && selection === undefined) {
    releaseHighlightStorage(device, storage, options.cost);
    return;
  }
  const storageReallocated = ensureHighlightStorage(device, storage, {
    minimumRecords: table.entries.length,
    selectionSlotCapacity: selection === undefined ? 0 : (options.slotCapacity ?? 0),
    selectionRecordCapacity: selection?.occurrences.length ?? 0,
    selectionWordCapacity: selection === undefined ? 0 : Math.ceil(selection.elementCount / 32),
    cost: options.cost,
  });
  const highlight = storage.highlight;
  const selectionChanged = highlight.denseSelection !== selection;
  const header = new Uint8Array(HIGHLIGHT_HEADER);
  const view = new Uint32Array(header.buffer);
  view[0] = entries.length;
  view[1] = table.bucketCount;
  view[2] = table.seed;
  writeSelectionHeader(view, highlight, selection, options.selectedTheme);
  writeChangedRanges(device, storage, header, table.entries, options.cost);
  highlight.data.set(header);
  if (selectionChanged) writeDenseSelectionData(highlight.data, highlight, selection);
  if (selectionChanged || storageReallocated) {
    writeDenseSelectionBuffer(device, highlight, highlight.data, options.cost);
  }
  highlight.denseSelection = selection;
}

function writeChangedRanges(
  device: GPUDevice,
  storage: HighlightTarget,
  header: Uint8Array,
  entries: readonly (HighlightTableEntry | undefined)[],
  cost?: GpuCostAccumulator,
): void {
  const highlight = storage.highlight;
  if (!sameBytes(header, highlight.data, 0, HIGHLIGHT_HEADER)) {
    device.queue.writeBuffer(storage.highlight.buffer, 0, header);
    cost?.write("highlight", HIGHLIGHT_HEADER);
  }
  const changedRecords: number[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const start = HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE;
    if (entry === undefined) {
      if (!sameBytes(ZERO_RECORD, highlight.data, start, ELEMENT_RECORD_STRIDE)) {
        highlight.data.fill(0, start, start + ELEMENT_RECORD_STRIDE);
        changedRecords.push(index);
      }
      continue;
    }
    const data = new Uint8Array(entry.data);
    if (!sameBytes(data, highlight.data, start, ELEMENT_RECORD_STRIDE)) {
      highlight.data.set(data, start);
      changedRecords.push(index);
    }
  }
  writeChangedRecordRanges(device, {
    buffer: storage.highlight.buffer,
    next: highlight.data,
    recordOffset: HIGHLIGHT_HEADER,
    recordStride: ELEMENT_RECORD_STRIDE,
    recordIndices: changedRecords,
    cost,
    category: "highlight",
  });
}

function sameBytes(
  next: Uint8Array,
  previous: Uint8Array,
  offset: number,
  length: number,
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (next[index] !== previous[offset + index]) return false;
  }
  return true;
}

interface HighlightCapacityOptions {
  readonly minimumRecords: number;
  readonly selectionSlotCapacity: number;
  readonly selectionRecordCapacity: number;
  readonly selectionWordCapacity: number;
  readonly cost: GpuCostAccumulator | undefined;
}

function ensureHighlightStorage(
  device: GPUDevice,
  storage: HighlightTarget,
  options: HighlightCapacityOptions,
): boolean {
  const current = storage.highlight;
  const releasesSelection =
    options.selectionSlotCapacity === 0 &&
    options.selectionRecordCapacity === 0 &&
    options.selectionWordCapacity === 0;
  const nextSparseCapacity =
    options.minimumRecords <= current.sparseCapacity
      ? current.sparseCapacity
      : Math.max(options.minimumRecords, current.sparseCapacity * 2);
  const nextSlotCapacity = releasesSelection
    ? 0
    : Math.max(current.selectionSlotCapacity, options.selectionSlotCapacity);
  const nextRecordCapacity = releasesSelection
    ? 0
    : Math.max(current.selectionRecordCapacity, options.selectionRecordCapacity);
  const nextWordCapacity = releasesSelection
    ? 0
    : Math.max(current.selectionWordCapacity, options.selectionWordCapacity);
  if (!storage.highlightOwned) {
    storage.highlight = createHighlightStorage(
      device,
      nextSparseCapacity,
      nextSlotCapacity,
      nextRecordCapacity,
      nextWordCapacity,
    );
    storage.highlightOwned = true;
    options.cost?.allocateBuffer(storage.highlight.buffer.size);
    invalidateHighlightBindGroups(storage, options.cost);
    return true;
  }
  if (
    nextSparseCapacity === current.sparseCapacity &&
    nextSlotCapacity === current.selectionSlotCapacity &&
    nextRecordCapacity === current.selectionRecordCapacity &&
    nextWordCapacity === current.selectionWordCapacity
  ) {
    return false;
  }
  const grown = createHighlightStorage(
    device,
    nextSparseCapacity,
    nextSlotCapacity,
    nextRecordCapacity,
    nextWordCapacity,
  );
  preserveDenseSelection(device, current, grown, options.cost);
  options.cost?.releaseBuffer(current.buffer.size);
  current.buffer.destroy();
  options.cost?.allocateBuffer(grown.buffer.size);
  storage.highlight = grown;
  storage.highlightOwned = true;
  invalidateHighlightBindGroups(storage, options.cost);
  return true;
}

function uploadPreservedDenseSelection(
  device: GPUDevice,
  storage: HighlightStorage,
  cost?: GpuCostAccumulator,
): void {
  if (storage.denseSelection === undefined) return;
  const offset = HIGHLIGHT_HEADER + storage.sparseCapacity * ELEMENT_RECORD_STRIDE;
  const bytes = storage.data.subarray(offset);
  device.queue.writeBuffer(storage.buffer, offset, bytes);
  cost?.write("highlight", bytes.byteLength);
}

function preserveDenseSelection(
  device: GPUDevice,
  current: HighlightStorage,
  next: HighlightStorage,
  cost?: GpuCostAccumulator,
): void {
  if (current.denseSelection === undefined) return;
  if (
    current.selectionSlotCapacity !== next.selectionSlotCapacity ||
    current.selectionRecordCapacity !== next.selectionRecordCapacity ||
    current.selectionWordCapacity !== next.selectionWordCapacity
  ) {
    return;
  }
  const oldOffset = current.sparseCapacity * (ELEMENT_RECORD_STRIDE / 4);
  const nextOffset = next.sparseCapacity * (ELEMENT_RECORD_STRIDE / 4);
  const slotBytes = current.selectionSlotCapacity * Uint32Array.BYTES_PER_ELEMENT;
  const bitBytes =
    current.selectionRecordCapacity * current.selectionWordCapacity * Uint32Array.BYTES_PER_ELEMENT;
  next.data.set(
    current.data.subarray(
      HIGHLIGHT_HEADER + oldOffset * 4,
      HIGHLIGHT_HEADER + oldOffset * 4 + slotBytes,
    ),
    HIGHLIGHT_HEADER + nextOffset * 4,
  );
  next.data.set(
    current.data.subarray(
      HIGHLIGHT_HEADER + (oldOffset + current.selectionSlotCapacity) * 4,
      HIGHLIGHT_HEADER + (oldOffset + current.selectionSlotCapacity) * 4 + bitBytes,
    ),
    HIGHLIGHT_HEADER + (nextOffset + next.selectionSlotCapacity) * 4,
  );
  next.denseSelection = current.denseSelection;
  uploadPreservedDenseSelection(device, next, cost);
}

function releaseHighlightStorage(
  device: GPUDevice,
  storage: HighlightTarget,
  cost?: GpuCostAccumulator,
): void {
  if (!storage.highlightOwned) return;
  const current = storage.highlight;
  device.queue.writeBuffer(current.buffer, 0, new Uint32Array(4));
  cost?.write("highlight", HIGHLIGHT_HEADER);
  cost?.releaseBuffer(current.buffer.size);
  current.buffer.destroy();
  storage.highlight = storage.emptyHighlight;
  storage.highlightOwned = false;
  invalidateHighlightBindGroups(storage, cost);
}

function invalidateHighlightBindGroups(storage: HighlightTarget, cost?: GpuCostAccumulator): void {
  cost?.invalidateBindGroups();
  storage.bindGroup = undefined;
  storage.nodeBindGroup = undefined;
  storage.edgeBindGroup = undefined;
  storage.transparentBindGroup = undefined;
  storage.selectionBindGroup = undefined;
  storage.subsetSelectionBindGroup = undefined;
  storage.nodeSelectionBindGroup = undefined;
  storage.subsetBindGroup = undefined;
  storage.subsetTransparentBindGroup = undefined;
}

function toTableEntry(update: EmphasisUpdate): HighlightTableEntry {
  if (update.edgePickId !== undefined) {
    return {
      slot: update.slot,
      elementPickId: update.edgePickId,
      facePickId: EDGE_HIGHLIGHT_MARKER,
      nodePickId: 0,
      data: encodeEmphasisRecord(update),
    };
  }
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
  readonly layout: DenseElementLayout;
  readonly slotByInstanceId: ReadonlyMap<InstanceId, number>;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly denseSelections?: DenseElementSelections;
}

interface HighlightTarget {
  highlight: HighlightStorage;
  emptyHighlight: HighlightStorage;
  highlightOwned: boolean;
  readonly capacity: number;
  bindGroup: GPUBindGroup | undefined;
  nodeBindGroup: GPUBindGroup | undefined;
  edgeBindGroup: GPUBindGroup | undefined;
  transparentBindGroup: GPUBindGroup | undefined;
  selectionBindGroup: GPUBindGroup | undefined;
  subsetSelectionBindGroup: GPUBindGroup | undefined;
  nodeSelectionBindGroup: GPUBindGroup | undefined;
  subsetBindGroup?: GPUBindGroup | undefined;
  subsetTransparentBindGroup?: GPUBindGroup | undefined;
}

/** Recomputes every part's emphasis table and writes only changed ranges. */
export function syncElementHighlights(
  sync: ElementHighlightSync,
  interaction: InteractionState,
  affectedParts?: ReadonlySet<PartId>,
  emphasisUpdates?: EmphasisUpdates,
): void {
  const denseSelections =
    sync.denseSelections ??
    collectDenseElementSelections(sync.runtime, sync.layout, sync.parts, interaction);
  const updates =
    emphasisUpdates ??
    collectEmphasisUpdates(sync.runtime, sync.layout, sync.slotByInstanceId, {
      parts: sync.parts,
      interaction,
      denseSelections,
    });
  const selectedTheme = readInteractionState(interaction).theme.selected;
  for (const [partId, storage] of sync.draw.storages) {
    if (affectedParts !== undefined && !affectedParts.has(partId)) continue;
    const selection = denseSelections.get(partId);
    writeElementHighlights(
      sync.device,
      storage,
      sparseUpdatesForPart({
        partId,
        updates: updates.get(partId) ?? [],
        selection,
        runtime: sync.runtime,
        layout: sync.layout,
        parts: sync.parts,
        interaction,
      }),
      {
        cost: sync.draw.cost,
        selection,
        selectedTheme,
        slotCapacity: storage.capacity,
      },
    );
  }
}
