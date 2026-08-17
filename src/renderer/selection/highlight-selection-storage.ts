import type { PrimitiveStyleOverride } from "../../interaction/interaction";
import { ELEMENT_RECORD_STRIDE, HIGHLIGHT_HEADER } from "../resources/element-resources";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { DenseElementSelection } from "./element-selection";

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
