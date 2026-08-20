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
  denseSelection: DenseElementSelection | undefined;
  denseVisibility: DenseElementSelection | undefined;
  denseNodeSelection: DenseNodeSelection | undefined;
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

/** Copies dense offsets and packed per-occurrence words into the fixed payload. */
export function writeDenseSelectionData(
  next: Uint8Array,
  storage: HighlightSelectionStorage,
  payload: DenseHighlightPayload,
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
  view.fill(0xffffffff, dataBase + offsetWord, dataBase + bitsWord);
  view.fill(
    0,
    dataBase + bitsWord,
    dataBase + bitsWord + storage.selectionRecordCapacity * storage.selectionWordCapacity,
  );
  view.fill(0xffffffff, dataBase + nodeOffsetWord, dataBase + nodeBitsWord);
  view.fill(
    0,
    dataBase + nodeBitsWord,
    dataBase +
      nodeBitsWord +
      storage.nodeSelectionRecordCapacity * storage.nodeSelectionWordCapacity,
  );
  view.fill(0xffffffff, dataBase + visibilityOffsetWord, dataBase + visibilityBitsWord);
  view.fill(
    0,
    dataBase + visibilityBitsWord,
    dataBase +
      visibilityBitsWord +
      storage.visibilityRecordCapacity * storage.visibilityWordCapacity,
  );
  if (selection !== undefined) {
    for (const [record, occurrence] of selection.occurrences.entries()) {
      view[dataBase + offsetWord + occurrence.slot] = record;
      view.set(occurrence.words, dataBase + bitsWord + record * storage.selectionWordCapacity);
    }
  }
  if (visibility !== undefined) {
    for (const [record, occurrence] of visibility.occurrences.entries()) {
      view[dataBase + visibilityOffsetWord + occurrence.slot] = record;
      view.set(
        occurrence.words,
        dataBase + visibilityBitsWord + record * storage.visibilityWordCapacity,
      );
    }
  }
  if (nodeSelection === undefined) return;
  for (const [record, occurrence] of nodeSelection.occurrences.entries()) {
    view[dataBase + nodeOffsetWord + occurrence.slot] = record;
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
