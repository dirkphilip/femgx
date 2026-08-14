import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { InstanceId } from "../scene/types";
import {
  buildHighlightTable,
  BLOCK_HIGHLIGHT_MARKER,
  BODY_HIGHLIGHT_MARKER,
  EDGE_HIGHLIGHT_MARKER,
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
  type EmphasisUpdates,
} from "./gpu-elements";
import type { GpuCostAccumulator } from "./gpu-cost";
import { writeChangedRecordRanges } from "./gpu-writes";
import type {
  DenseElementLayout,
  DenseElementSelection,
  DenseElementSelections,
} from "./gpu-element-selection";
import { denseSelectionContains, collectDenseElementSelections } from "./gpu-element-selection";
import {
  highlightByteLength,
  writeChangedSelectionRanges,
  writeDenseSelectionData,
  writeSelectionHeader,
} from "./gpu-highlight-selection-storage";
import { getPartInteractionMetadata } from "./part-interaction-metadata";
import { readInteractionState } from "../interaction/state";
import type { PrimitiveStyleOverride } from "../interaction/interaction";

/** A GPU highlight buffer plus its full CPU mirror for diffed writes. */
export interface HighlightStorage {
  readonly buffer: GPUBuffer;
  data: Uint8Array<ArrayBuffer>;
  sparseCapacity: number;
  selectionSlotCapacity: number;
  selectionRecordCapacity: number;
  selectionWordCapacity: number;
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
  ensureHighlightStorage(device, storage, {
    minimumRecords: table.entries.length,
    selectionSlotCapacity: options.slotCapacity ?? 0,
    selectionRecordCapacity: selection?.occurrences.length ?? 0,
    selectionWordCapacity: selection === undefined ? 0 : Math.ceil(selection.elementCount / 32),
  });
  const next = new Uint8Array(storage.highlight.data.length);
  const view = new Uint32Array(next.buffer);
  view[0] = entries.length;
  view[1] = table.bucketCount;
  view[2] = table.seed;
  writeSelectionHeader(view, storage.highlight, selection, options.selectedTheme);
  for (let index = 0; index < table.entries.length; index += 1) {
    const entry = table.entries[index];
    if (entry === undefined) continue;
    next.set(new Uint8Array(entry.data), HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE);
  }
  writeDenseSelectionData(next, storage.highlight, selection);
  writeChangedRanges(device, storage, next, table.bucketCount, options.cost);
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
  writeChangedSelectionRanges(device, storage.highlight, next, cost);
}

function recordChanged(next: Uint8Array, previous: Uint8Array, index: number): boolean {
  const start = HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE;
  for (let offset = 0; offset < ELEMENT_RECORD_STRIDE; offset += 1) {
    if (next[start + offset] !== previous[start + offset]) return true;
  }
  return false;
}

interface HighlightCapacityOptions {
  readonly minimumRecords: number;
  readonly selectionSlotCapacity: number;
  readonly selectionRecordCapacity: number;
  readonly selectionWordCapacity: number;
}

function ensureHighlightStorage(
  device: GPUDevice,
  storage: HighlightTarget,
  options: HighlightCapacityOptions,
): void {
  const highlight = storage.highlight;
  const nextSparseCapacity =
    options.minimumRecords <= highlight.sparseCapacity
      ? highlight.sparseCapacity
      : Math.max(options.minimumRecords, highlight.sparseCapacity * 2);
  const nextSlotCapacity = Math.max(highlight.selectionSlotCapacity, options.selectionSlotCapacity);
  const nextRecordCapacity = Math.max(
    highlight.selectionRecordCapacity,
    options.selectionRecordCapacity,
  );
  const nextWordCapacity = Math.max(highlight.selectionWordCapacity, options.selectionWordCapacity);
  if (
    nextSparseCapacity === highlight.sparseCapacity &&
    nextSlotCapacity === highlight.selectionSlotCapacity &&
    nextRecordCapacity === highlight.selectionRecordCapacity &&
    nextWordCapacity === highlight.selectionWordCapacity
  ) {
    return;
  }
  const grown = createHighlightStorage(
    device,
    nextSparseCapacity,
    nextSlotCapacity,
    nextRecordCapacity,
    nextWordCapacity,
  );
  highlight.buffer.destroy();
  storage.highlight = grown;
  storage.bindGroup = undefined;
  storage.edgeBindGroup = undefined;
  storage.transparentBindGroup = undefined;
  storage.selectionBindGroup = undefined;
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
  const blockPickId = update.blockPickId ?? 0;
  return {
    slot: update.slot,
    elementPickId:
      bodyPickId === 0 ? (blockPickId === 0 ? update.elementPickId : blockPickId) : bodyPickId,
    facePickId:
      bodyPickId === 0
        ? blockPickId === 0
          ? update.facePickId
          : BLOCK_HIGHLIGHT_MARKER
        : BODY_HIGHLIGHT_MARKER,
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
  readonly capacity: number;
  bindGroup: GPUBindGroup | undefined;
  edgeBindGroup: GPUBindGroup | undefined;
  transparentBindGroup: GPUBindGroup | undefined;
  selectionBindGroup: GPUBindGroup | undefined;
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
  const updates =
    emphasisUpdates ??
    collectEmphasisUpdates(
      sync.runtime,
      sync.layout,
      sync.slotByInstanceId,
      sync.parts,
      interaction,
    );
  const denseSelections =
    sync.denseSelections ??
    collectDenseElementSelections(sync.runtime, sync.layout, sync.parts, interaction);
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

interface SparseUpdateOptions {
  readonly partId: PartId;
  readonly updates: readonly EmphasisUpdate[];
  readonly selection: DenseElementSelection | undefined;
  readonly runtime: PackedSceneRuntime;
  readonly layout: DenseElementLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
}

function sparseUpdatesForPart(options: SparseUpdateOptions): readonly EmphasisUpdate[] {
  if (options.selection === undefined) return options.updates;
  const part = options.parts.get(options.partId);
  if (part === undefined) return options.updates;
  const metadata = getPartInteractionMetadata(part);
  const data = readInteractionState(options.interaction);
  const globalSlots = options.layout.partSlots.get(options.partId);
  return options.updates.filter((update) => {
    if (update.selected !== true || update.elementPickId === 0) return true;
    const elementId = update.elementPickId - 1;
    const ordinal = metadata.elementOrdinalById.get(elementId);
    if (ordinal === undefined || !denseSelectionContains(options.selection, update.slot, ordinal)) {
      return true;
    }
    const globalSlot = globalSlots?.[update.slot];
    const instanceId =
      globalSlot === undefined ? undefined : options.runtime.getInstanceId(globalSlot);
    if (instanceId === undefined) return true;
    return (
      update.hidden === true ||
      data.highlightedElementIds.get(instanceId)?.has(elementId) === true ||
      data.hiddenElementIds.get(instanceId)?.has(elementId) === true ||
      data.elementOverrides.get(instanceId)?.has(elementId) === true ||
      (data.hoveredTarget?.kind === "element" &&
        data.hoveredTarget.instanceId === instanceId &&
        data.hoveredTarget.elementId === elementId)
    );
  });
}
