import { expect, it, describe } from "vitest";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  HIGHLIGHT_BUCKET_SIZE,
  INITIAL_ELEMENT_HIGHLIGHTS,
  createHighlightStorage,
  elementUpdate,
  fakeGpuDevice,
  installGpuGlobals,
  makeStorage,
  writeElementHighlights,
} from "./support";

describe("createHighlightStorage", () => {
  it("allocates a buffer matching the header plus the requested record capacity", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = createHighlightStorage(gpu.device, 4);
      const expected = HIGHLIGHT_HEADER + 4 * ELEMENT_RECORD_STRIDE;
      expect(storage.data.byteLength).toBe(expected);
      expect(gpu.buffers[0]?.size).toBe(expected);
    } finally {
      restore();
    }
  });

  it("defaults to the initial capacity so small selections never grow the buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = createHighlightStorage(gpu.device);
      const expected = HIGHLIGHT_HEADER + INITIAL_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE;
      expect(storage.data.byteLength).toBe(expected);
      expect(gpu.buffers[0]?.size).toBe(expected);
    } finally {
      restore();
    }
  });

  it("keeps stale inactive records resident when a high-water table shrinks", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const highWater = Array.from({ length: 80 }, (_, index) => elementUpdate(index, index));
      writeElementHighlights(gpu.device, storage, highWater);
      const beforeShrink = storage.highlight.data.slice();
      const afterHighWater = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, [elementUpdate(0, 999)]);

      const activeSlots =
        (new Uint32Array(storage.highlight.data.buffer)[1] ?? 0) * HIGHLIGHT_BUCKET_SIZE;
      const staleIndex = findNonZeroRecord(beforeShrink, activeSlots);
      expect(staleIndex).toBeGreaterThanOrEqual(activeSlots);
      expect(recordBytes(storage.highlight.data, staleIndex)).toEqual(
        recordBytes(beforeShrink, staleIndex),
      );
      expect(
        gpu.writes
          .slice(afterHighWater)
          .every(
            (write) =>
              write.offset === 0 ||
              write.offset + write.bytes.byteLength <=
                HIGHLIGHT_HEADER + activeSlots * ELEMENT_RECORD_STRIDE,
          ),
      ).toBe(true);
    } finally {
      restore();
    }
  });

  it("overwrites stale records and holes when a sparse table grows again", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(
        gpu.device,
        storage,
        Array.from({ length: 80 }, (_, index) => elementUpdate(index, index)),
      );
      writeElementHighlights(gpu.device, storage, [elementUpdate(0, 999)]);
      const regrown = Array.from({ length: 80 }, (_, index) => elementUpdate(index, index + 1_000));
      writeElementHighlights(gpu.device, storage, regrown);
      const replayed = new Uint8Array(storage.highlight.data.byteLength);
      for (const write of gpu.writes) {
        if (write.buffer === storage.highlight.buffer) replayed.set(write.bytes, write.offset);
      }
      expect(replayed).toEqual(storage.highlight.data);
    } finally {
      restore();
    }
  });
});

function findNonZeroRecord(data: Uint8Array, startRecord: number): number {
  const recordCount = (data.byteLength - HIGHLIGHT_HEADER) / ELEMENT_RECORD_STRIDE;
  for (let index = startRecord; index < recordCount; index += 1) {
    if (!recordBytes(data, index).every((value) => value === 0)) return index;
  }
  return -1;
}

function recordBytes(data: Uint8Array, index: number): Uint8Array {
  const start = HIGHLIGHT_HEADER + index * ELEMENT_RECORD_STRIDE;
  return data.subarray(start, start + ELEMENT_RECORD_STRIDE);
}
