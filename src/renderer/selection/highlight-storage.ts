import type { Part } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PartId } from "../../geometry/part";
import type { PartOccurrenceId } from "../../scene/types";
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
  type EmphasisUpdate,
  type EmphasisUpdates,
} from "../resources/element-resources";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import { writeChangedRecordRanges } from "../resources/buffer-writes";
import {
  ensureHighlightStorage,
  invalidateHighlightBindGroups,
  type HighlightAllocationTarget,
} from "./highlight-storage-allocation";
import type {
  DenseElementLayout,
  DenseElementSelection,
  DenseElementSelections,
} from "./element-selection";
import { collectDenseElementSelections } from "./element-selection";
import type { DenseNodeSelection, DenseNodeSelections } from "./node-selection";
import {
  writeDenseSelectionBuffer,
  writeDenseSelectionData,
  writeSelectionHeader,
  captureStagedHighlightRange,
  type DenseHighlightPayload,
  type HighlightStorage,
} from "./highlight-selection-storage";
import { readInteractionState } from "../../interaction/state";
import type { PrimitiveStyleOverride } from "../../interaction/interaction";
import { sparseUpdatesForPart } from "./highlight-filter";
import { directBufferWritePort, type BufferWritePort } from "../resources/buffer-write-port";

export {
  createHighlightRevisionJournal,
  rollbackStagedHighlight,
  type HighlightStorage,
} from "./highlight-selection-storage";
export { createHighlightStorage } from "./highlight-storage-allocation";

const ZERO_RECORD = new Uint8Array(ELEMENT_RECORD_STRIDE);
const EMPTY_HIGHLIGHT_HEADER = new Uint32Array(4);

interface HighlightWriteOptions {
  readonly writePort?: BufferWritePort;
  readonly cost?: GpuCostAccumulator;
  readonly selection?: DenseElementSelection | undefined;
  readonly visibility?: DenseElementSelection | undefined;
  readonly nodeSelection?: DenseNodeSelection | undefined;
  readonly selectedTheme?: PrimitiveStyleOverride | undefined;
  readonly slotCapacity?: number;
}

/** Writes the changed header and fixed-size emphasis record ranges. */
// eslint-disable-next-line max-lines-per-function -- Transaction capture must remain adjacent to each sparse highlight write.
export function writeElementHighlights(
  device: GPUDevice,
  storage: HighlightTarget,
  updates: readonly EmphasisUpdate[],
  options: HighlightWriteOptions = {},
): void {
  const writePort = options.writePort ?? directBufferWritePort(device);
  const entries = updates.map(toHighlightTableEntry);
  const table = buildHighlightTable(entries);
  const selection = options.selection;
  const nodeSelection = options.nodeSelection;
  const visibility = options.visibility;
  const payload: DenseHighlightPayload = { selection, visibility, nodeSelection };
  if (
    table.entries.length === 0 &&
    selection === undefined &&
    visibility === undefined &&
    nodeSelection === undefined
  ) {
    releaseHighlightStorage(device, storage, options.cost, writePort);
    return;
  }
  const storageReallocated = ensureHighlightStorage(device, storage, {
    minimumRecords: table.entries.length,
    selectionSlotCapacity:
      selection === undefined && visibility === undefined ? 0 : (options.slotCapacity ?? 0),
    selectionRecordCapacity: selection?.occurrences.length ?? 0,
    selectionWordCapacity: selection === undefined ? 0 : Math.ceil(selection.elementCount / 32),
    visibilityRecordCapacity: visibility?.occurrences.length ?? 0,
    visibilityWordCapacity: visibility === undefined ? 0 : Math.ceil(visibility.elementCount / 32),
    nodeSelectionSlotCapacity: nodeSelection === undefined ? 0 : (options.slotCapacity ?? 0),
    nodeSelectionRecordCapacity: nodeSelection?.occurrences.length ?? 0,
    nodeSelectionWordCapacity:
      nodeSelection === undefined ? 0 : Math.ceil(nodeSelection.nodeCount / 32),
    cost: options.cost,
  });
  const highlight = storage.highlight;
  const selectionChanged =
    highlight.denseSelection !== selection ||
    highlight.denseVisibility !== visibility ||
    highlight.denseNodeSelection !== nodeSelection;
  const header = new Uint8Array(HIGHLIGHT_HEADER);
  const view = new Uint32Array(header.buffer);
  view[0] = entries.length;
  view[1] = table.bucketCount;
  view[2] = table.seed;
  writeSelectionHeader(view, highlight, payload, options.selectedTheme);
  writeChangedRanges(writePort, storage, header, table.entries, options.cost);
  captureStagedHighlightRange(highlight, 0, HIGHLIGHT_HEADER);
  highlight.data.set(header);
  if (selectionChanged) {
    writeDenseSelectionData(highlight.data, highlight, payload, (startWord, endWord) => {
      captureStagedHighlightRange(highlight, startWord * 4, endWord * 4);
    });
  }
  if (selectionChanged || storageReallocated) {
    writeDenseSelectionBuffer(device, highlight, highlight.data, options.cost, writePort);
  }
  highlight.denseSelection = selection;
  highlight.denseVisibility = visibility;
  highlight.denseNodeSelection = nodeSelection;
}

function writeChangedRanges(
  writePort: BufferWritePort,
  storage: HighlightTarget,
  header: Uint8Array,
  entries: readonly (HighlightTableEntry | undefined)[],
  cost?: GpuCostAccumulator,
): void {
  const highlight = storage.highlight;
  if (!sameBytes(header, highlight.data, 0, HIGHLIGHT_HEADER)) {
    writePort.writeBuffer(storage.highlight.buffer, 0, header);
    cost?.write("highlight", HIGHLIGHT_HEADER);
  }
  const changedRecords: number[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const start = HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE;
    if (entry === undefined) {
      if (!sameBytes(ZERO_RECORD, highlight.data, start, ELEMENT_RECORD_STRIDE)) {
        captureStagedHighlightRange(highlight, start, start + ELEMENT_RECORD_STRIDE);
        highlight.data.fill(0, start, start + ELEMENT_RECORD_STRIDE);
        changedRecords.push(index);
      }
      continue;
    }
    const data = new Uint8Array(entry.data);
    if (!sameBytes(data, highlight.data, start, ELEMENT_RECORD_STRIDE)) {
      captureStagedHighlightRange(highlight, start, start + ELEMENT_RECORD_STRIDE);
      highlight.data.set(data, start);
      changedRecords.push(index);
    }
  }
  writeChangedRecordRanges(writePort, {
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

function releaseHighlightStorage(
  device: GPUDevice,
  storage: HighlightTarget,
  cost?: GpuCostAccumulator,
  writePort = directBufferWritePort(device),
): void {
  if (!storage.highlightOwned) return;
  const current = storage.highlight;
  writePort.writeBuffer(current.buffer, 0, EMPTY_HIGHLIGHT_HEADER);
  cost?.write("highlight", EMPTY_HIGHLIGHT_HEADER.byteLength);
  if (!storage.deferRelease) {
    cost?.releaseBuffer(current.buffer.size);
    current.buffer.destroy();
  }
  storage.highlight = storage.emptyHighlight;
  storage.highlightOwned = false;
  invalidateHighlightBindGroups(storage, cost);
}

/** Converts one CPU emphasis update into its packed hash-table identity. */
export function toHighlightTableEntry(update: EmphasisUpdate): HighlightTableEntry {
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
    readonly writePort: BufferWritePort;
  };
  readonly runtime: PackedSceneRuntime;
  readonly layout: DenseElementLayout;
  readonly slotByInstanceId: ReadonlyMap<PartOccurrenceId, number>;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly denseSelections?: DenseElementSelections;
  readonly denseVisibility?: DenseElementSelections;
  readonly denseNodeSelections?: DenseNodeSelections;
}

interface HighlightTarget extends HighlightAllocationTarget {
  emptyHighlight: HighlightStorage;
  readonly capacity: number;
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
      ...(sync.denseVisibility === undefined ? {} : { denseHidden: sync.denseVisibility }),
      ...(sync.denseNodeSelections === undefined
        ? {}
        : { denseNodeSelections: sync.denseNodeSelections }),
    });
  const selectedTheme = readInteractionState(interaction).theme.selected;
  const partIds = affectedParts ?? sync.draw.storages.keys();
  for (const partId of partIds) {
    const storage = sync.draw.storages.get(partId);
    if (storage === undefined) continue;
    const selection = denseSelections.get(partId);
    const nodeSelection = sync.denseNodeSelections?.get(partId);
    const visibility = sync.denseVisibility?.get(partId);
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
        writePort: sync.draw.writePort,
        cost: sync.draw.cost,
        selection,
        visibility,
        nodeSelection,
        selectedTheme,
        slotCapacity: storage.capacity,
      },
    );
  }
}
