import type { PrimitiveStyleOverride } from "../../interaction/interaction";
import { ELEMENT_RECORD_STRIDE, HIGHLIGHT_HEADER } from "../resources/element-resources";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { DenseElementSelection } from "./element-selection";
import type { DenseNodeSelection } from "./node-selection";

/** The storage fields required to pack dense element and node membership. */
export interface HighlightSelectionStorage {
  readonly buffer: GPUBuffer;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly sparseCapacity: number;
  readonly selectionSlotCapacity: number;
  readonly selectionRecordCapacity: number;
  readonly selectionWordCapacity: number;
  readonly visibilityRecordCapacity: number;
  readonly visibilityWordCapacity: number;
  readonly nodeSelectionSlotCapacity: number;
  readonly nodeSelectionRecordCapacity: number;
  readonly nodeSelectionWordCapacity: number;
}

/** A GPU highlight buffer plus its full CPU mirror for diffed writes. */
export interface HighlightStorage extends HighlightSelectionStorage {
  /** Exact bytes changed while a definition revision is staged. */
  readonly revisionJournal?: HighlightRevisionJournal;
  denseSelection: DenseElementSelection | undefined;
  denseVisibility: DenseElementSelection | undefined;
  denseNodeSelection: DenseNodeSelection | undefined;
}

/** Sparse rollback journal for a retained highlight CPU mirror. */
export interface HighlightRevisionJournal {
  readonly bytes: Map<number, number>;
}

/** Starts a sparse staged-highlight journal. */
export function createHighlightRevisionJournal(): HighlightRevisionJournal {
  return { bytes: new Map() };
}

/** Captures a byte range before a staged highlight mutation. */
export function captureStagedHighlightRange(
  storage: HighlightStorage,
  start: number,
  end: number,
): void {
  const journal = storage.revisionJournal;
  if (journal === undefined) return;
  for (let index = start; index < end; index += 1) {
    if (!journal.bytes.has(index)) journal.bytes.set(index, storage.data[index] ?? 0);
  }
}

/** Restores sparse staged highlight bytes after a transaction failure. */
export function rollbackStagedHighlight(storage: HighlightStorage): void {
  for (const [index, value] of storage.revisionJournal?.bytes ?? []) storage.data[index] = value;
}

/** Dense membership sections packed beside the sparse emphasis table. */
export interface DenseHighlightPayload {
  readonly selection: DenseElementSelection | undefined;
  readonly visibility: DenseElementSelection | undefined;
  readonly nodeSelection: DenseNodeSelection | undefined;
}

/** Dense and sparse capacities used to size one highlight payload. */
export interface HighlightPayloadCapacity {
  readonly sparseCapacity: number;
  readonly selectionSlotCapacity: number;
  readonly selectionRecordCapacity: number;
  readonly selectionWordCapacity: number;
  readonly visibilityRecordCapacity: number;
  readonly visibilityWordCapacity: number;
  readonly nodeSelectionSlotCapacity: number;
  readonly nodeSelectionRecordCapacity: number;
  readonly nodeSelectionWordCapacity: number;
}

/** Returns the byte size of a sparse-plus-dense highlight allocation. */
export function highlightByteLength(capacity: HighlightPayloadCapacity): number {
  return (
    HIGHLIGHT_HEADER +
    capacity.sparseCapacity * ELEMENT_RECORD_STRIDE +
    capacity.selectionSlotCapacity * 4 +
    capacity.selectionRecordCapacity * capacity.selectionWordCapacity * 4 +
    capacity.selectionSlotCapacity * 4 +
    capacity.visibilityRecordCapacity * capacity.visibilityWordCapacity * 4 +
    capacity.nodeSelectionSlotCapacity * 4 +
    capacity.nodeSelectionRecordCapacity * capacity.nodeSelectionWordCapacity * 4
  );
}

/** Writes dense-selection metadata into the fixed highlight header. */
export function writeSelectionHeader(
  view: Uint32Array,
  storage: HighlightSelectionStorage,
  payload: DenseHighlightPayload,
  selectedTheme: PrimitiveStyleOverride | undefined,
): void {
  const { selection, nodeSelection, visibility } = payload;
  const sparseWords = storage.sparseCapacity * (ELEMENT_RECORD_STRIDE / 4);
  const offsetWord = sparseWords;
  const bitsWord = offsetWord + storage.selectionSlotCapacity;
  const visibilityOffsetWord =
    bitsWord + storage.selectionRecordCapacity * storage.selectionWordCapacity;
  const visibilityBitsWord = visibilityOffsetWord + storage.selectionSlotCapacity;
  const nodeOffsetWord =
    visibilityBitsWord + storage.visibilityRecordCapacity * storage.visibilityWordCapacity;
  const nodeBitsWord = nodeOffsetWord + storage.nodeSelectionSlotCapacity;
  view[3] =
    selection === undefined
      ? storage.selectionWordCapacity
      : Math.ceil(selection.elementCount / 32);
  view[4] = offsetWord;
  view[5] = bitsWord;
  view[6] = selection?.occurrences.length ?? 0;
  view[7] = storage.selectionSlotCapacity;
  const theme = selectedTheme ?? {};
  let flags = 0;
  const floats = new Float32Array(view.buffer);
  if (theme.color !== undefined) {
    flags |= 1;
    floats[9] = theme.color.r;
    floats[10] = theme.color.g;
    floats[11] = theme.color.b;
    floats[12] = theme.color.a;
  }
  if (theme.emissive !== undefined) {
    flags |= 4;
    floats[13] = theme.emissive;
  }
  if (theme.opacity !== undefined) {
    flags |= 2;
    floats[14] = theme.opacity;
  }
  view[8] = selection === undefined && nodeSelection === undefined ? 0 : flags;
  view[15] =
    nodeSelection === undefined
      ? storage.nodeSelectionWordCapacity
      : Math.ceil(nodeSelection.nodeCount / 32);
  view[16] = nodeOffsetWord;
  view[17] = nodeBitsWord;
  view[18] = nodeSelection?.occurrences.length ?? 0;
  view[19] = storage.nodeSelectionSlotCapacity;
  view[20] =
    visibility === undefined
      ? storage.visibilityWordCapacity
      : Math.ceil(visibility.elementCount / 32);
  view[21] = visibilityOffsetWord;
  view[22] = visibilityBitsWord;
  view[23] = visibility?.occurrences.length ?? 0;
}

/**
 * Copies dense offsets and packed per-occurrence words into the fixed payload.
 * This allocation-free linear kernel keeps sparse rollback capture adjacent to each write.
 */
// eslint-disable-next-line max-lines-per-function -- Splitting this measured packing kernel would add callback state in its hot loop.
export function writeDenseSelectionData(
  next: Uint8Array,
  storage: HighlightSelectionStorage,
  payload: DenseHighlightPayload,
  capture?: (startWord: number, endWord: number) => void,
): void {
  const { selection, nodeSelection, visibility } = payload;
  const view = new Uint32Array(next.buffer);
  const offsetWord = view[4] ?? 0;
  const bitsWord = view[5] ?? 0;
  const nodeOffsetWord = view[16] ?? 0;
  const nodeBitsWord = view[17] ?? 0;
  const visibilityOffsetWord = view[21] ?? 0;
  const visibilityBitsWord = view[22] ?? 0;
  const dataBase = HIGHLIGHT_HEADER / 4;
  capture?.(dataBase + offsetWord, dataBase + bitsWord);
  view.fill(0xffffffff, dataBase + offsetWord, dataBase + bitsWord);
  capture?.(
    dataBase + bitsWord,
    dataBase + bitsWord + storage.selectionRecordCapacity * storage.selectionWordCapacity,
  );
  view.fill(
    0,
    dataBase + bitsWord,
    dataBase + bitsWord + storage.selectionRecordCapacity * storage.selectionWordCapacity,
  );
  capture?.(dataBase + nodeOffsetWord, dataBase + nodeBitsWord);
  view.fill(0xffffffff, dataBase + nodeOffsetWord, dataBase + nodeBitsWord);
  capture?.(
    dataBase + nodeBitsWord,
    dataBase +
      nodeBitsWord +
      storage.nodeSelectionRecordCapacity * storage.nodeSelectionWordCapacity,
  );
  view.fill(
    0,
    dataBase + nodeBitsWord,
    dataBase +
      nodeBitsWord +
      storage.nodeSelectionRecordCapacity * storage.nodeSelectionWordCapacity,
  );
  capture?.(dataBase + visibilityOffsetWord, dataBase + visibilityBitsWord);
  view.fill(0xffffffff, dataBase + visibilityOffsetWord, dataBase + visibilityBitsWord);
  capture?.(
    dataBase + visibilityBitsWord,
    dataBase +
      visibilityBitsWord +
      storage.visibilityRecordCapacity * storage.visibilityWordCapacity,
  );
  view.fill(
    0,
    dataBase + visibilityBitsWord,
    dataBase +
      visibilityBitsWord +
      storage.visibilityRecordCapacity * storage.visibilityWordCapacity,
  );
  if (selection !== undefined) {
    for (const [record, occurrence] of selection.occurrences.entries()) {
      capture?.(
        dataBase + offsetWord + occurrence.slot,
        dataBase + offsetWord + occurrence.slot + 1,
      );
      view[dataBase + offsetWord + occurrence.slot] = record;
      capture?.(
        dataBase + bitsWord + record * storage.selectionWordCapacity,
        dataBase + bitsWord + (record + 1) * storage.selectionWordCapacity,
      );
      view.set(occurrence.words, dataBase + bitsWord + record * storage.selectionWordCapacity);
    }
  }
  if (visibility !== undefined) {
    for (const [record, occurrence] of visibility.occurrences.entries()) {
      capture?.(
        dataBase + visibilityOffsetWord + occurrence.slot,
        dataBase + visibilityOffsetWord + occurrence.slot + 1,
      );
      view[dataBase + visibilityOffsetWord + occurrence.slot] = record;
      capture?.(
        dataBase + visibilityBitsWord + record * storage.visibilityWordCapacity,
        dataBase + visibilityBitsWord + (record + 1) * storage.visibilityWordCapacity,
      );
      view.set(
        occurrence.words,
        dataBase + visibilityBitsWord + record * storage.visibilityWordCapacity,
      );
    }
  }
  if (nodeSelection === undefined) return;
  for (const [record, occurrence] of nodeSelection.occurrences.entries()) {
    capture?.(
      dataBase + nodeOffsetWord + occurrence.slot,
      dataBase + nodeOffsetWord + occurrence.slot + 1,
    );
    view[dataBase + nodeOffsetWord + occurrence.slot] = record;
    capture?.(
      dataBase + nodeBitsWord + record * storage.nodeSelectionWordCapacity,
      dataBase + nodeBitsWord + (record + 1) * storage.nodeSelectionWordCapacity,
    );
    view.set(
      occurrence.words,
      dataBase + nodeBitsWord + record * storage.nodeSelectionWordCapacity,
    );
  }
}

/** Uploads the packed dense-selection payload as one deterministic GPU write. */
export function writeDenseSelectionBuffer(
  device: GPUDevice,
  storage: HighlightSelectionStorage,
  next: Uint8Array,
  cost?: GpuCostAccumulator,
): void {
  const start = HIGHLIGHT_HEADER + storage.sparseCapacity * ELEMENT_RECORD_STRIDE;
  const payload = next.subarray(start);
  if (payload.byteLength === 0) return;
  device.queue.writeBuffer(storage.buffer, start, payload);
  cost?.write("highlight", payload.byteLength);
}
