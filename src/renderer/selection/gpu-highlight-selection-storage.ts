import type { PrimitiveStyleOverride } from "../../interaction/interaction";
import { ELEMENT_RECORD_STRIDE, HIGHLIGHT_HEADER } from "../resources/gpu-elements";
import type { GpuCostAccumulator } from "../core/gpu-cost";
import type { DenseElementSelection } from "./gpu-element-selection";
import { writeChangedRecordRanges } from "../core/gpu-writes";

/** The storage fields required to pack dense selected-element membership. */
export interface HighlightSelectionStorage {
  readonly buffer: GPUBuffer;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly sparseCapacity: number;
  readonly selectionSlotCapacity: number;
  readonly selectionRecordCapacity: number;
  readonly selectionWordCapacity: number;
}

/** Returns the byte size of a sparse-plus-dense highlight allocation. */
export function highlightByteLength(
  sparseCapacity: number,
  selectionSlotCapacity: number,
  selectionRecordCapacity: number,
  selectionWordCapacity: number,
): number {
  return (
    HIGHLIGHT_HEADER +
    sparseCapacity * ELEMENT_RECORD_STRIDE +
    selectionSlotCapacity * 4 +
    selectionRecordCapacity * selectionWordCapacity * 4
  );
}

/** Writes dense-selection metadata into the fixed highlight header. */
export function writeSelectionHeader(
  view: Uint32Array,
  storage: HighlightSelectionStorage,
  selection: DenseElementSelection | undefined,
  selectedTheme: PrimitiveStyleOverride | undefined,
): void {
  const sparseWords = storage.sparseCapacity * (ELEMENT_RECORD_STRIDE / 4);
  const offsetWord = sparseWords;
  const bitsWord = offsetWord + storage.selectionSlotCapacity;
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
  view[8] = selection === undefined ? 0 : flags;
}

/** Rebuilds the dense offset table and compact per-occurrence bitsets. */
export function writeDenseSelectionData(
  next: Uint8Array,
  storage: HighlightSelectionStorage,
  selection: DenseElementSelection | undefined,
): void {
  const view = new Uint32Array(next.buffer);
  const offsetWord = view[4] ?? 0;
  const bitsWord = view[5] ?? 0;
  const dataBase = HIGHLIGHT_HEADER / 4;
  view.fill(0xffffffff, dataBase + offsetWord, dataBase + bitsWord);
  view.fill(
    0,
    dataBase + bitsWord,
    dataBase + bitsWord + storage.selectionRecordCapacity * storage.selectionWordCapacity,
  );
  if (selection === undefined) return;
  for (const [record, occurrence] of selection.occurrences.entries()) {
    view[dataBase + offsetWord + occurrence.slot] = record;
    for (const ordinal of occurrence.ordinals) {
      const bit = ordinal - 1;
      const word = bit >> 5;
      const index = dataBase + bitsWord + record * storage.selectionWordCapacity + word;
      view[index] = (view[index] ?? 0) | (1 << (bit & 31));
    }
  }
}

/** Writes only changed dense offset and bitset words to the GPU. */
export function writeChangedSelectionRanges(
  device: GPUDevice,
  storage: HighlightSelectionStorage,
  next: Uint8Array,
  cost?: GpuCostAccumulator,
): void {
  const previous = storage.data;
  const nextView = new Uint32Array(next.buffer);
  const previousView = new Uint32Array(previous.buffer);
  const nextOffset = nextView[4] ?? 0;
  const previousOffset = previousView[4] ?? 0;
  const nextSlots = nextView[7] ?? 0;
  const previousSlots = previousView[7] ?? 0;
  const dataBase = HIGHLIGHT_HEADER / 4;
  const changedOffsets: number[] = [];
  for (let slot = 0; slot < Math.max(nextSlots, previousSlots); slot += 1) {
    if (
      readWord(nextView, dataBase + nextOffset + slot) !==
      readWord(previousView, dataBase + previousOffset + slot)
    ) {
      changedOffsets.push(slot);
    }
  }
  writeChangedRecordRanges(device, {
    buffer: storage.buffer,
    next,
    recordOffset: HIGHLIGHT_HEADER + nextOffset * 4,
    recordStride: 4,
    recordIndices: changedOffsets,
    cost,
    category: "highlight",
  });
  const nextBits = nextView[5] ?? 0;
  const previousBits = previousView[5] ?? 0;
  const wordCount = storage.selectionRecordCapacity * storage.selectionWordCapacity;
  const changedBits: number[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    if (
      readWord(nextView, dataBase + nextBits + index) !==
      readWord(previousView, dataBase + previousBits + index)
    ) {
      changedBits.push(index);
    }
  }
  writeChangedRecordRanges(device, {
    buffer: storage.buffer,
    next,
    recordOffset: HIGHLIGHT_HEADER + nextBits * 4,
    recordStride: 4,
    recordIndices: changedBits,
    cost,
    category: "highlight",
  });
}

function readWord(view: Uint32Array, index: number): number {
  return index >= 0 && index < view.length ? (view[index] ?? 0) : 0;
}
