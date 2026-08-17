import { expect, it, describe } from "vitest";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
  writeElementHighlights,
  HIGHLIGHT_BUCKET_SIZE,
  fakeGpuDevice,
  installGpuGlobals,
  style,
  elementUpdate,
  bodyUpdate,
  makeStorage,
} from "./support";

describe("writeElementHighlights", () => {
  it("writes one complete record across selection deltas", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [elementUpdate(1, 0)]);
      const afterFirst = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, [elementUpdate(1, 0)]);
      expect(gpu.writes.length).toBe(afterFirst);
      writeElementHighlights(gpu.device, storage, [elementUpdate(1, 7)]);
      expect(
        gpu.writes.slice(afterFirst).map((write) => [write.offset, write.bytes.byteLength]),
      ).toEqual([[HIGHLIGHT_HEADER, ELEMENT_RECORD_STRIDE]]);
    } finally {
      restore();
    }
  });

  it("coalesces dense emphasis changes into fixed-record ranges", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const updates = Array.from({ length: 80 }, (_, index) => elementUpdate(index, index));
      writeElementHighlights(gpu.device, storage, updates);
      const afterFirst = gpu.writes.length;

      writeElementHighlights(
        gpu.device,
        storage,
        updates.map((update) => ({ ...update, style: { ...style, emissive: 0.25 } })),
      );

      const writes = gpu.writes.slice(afterFirst);
      expect(writes.length).toBeLessThan(updates.length);
      expect(
        writes.every(
          (write) =>
            (write.offset - HIGHLIGHT_HEADER) % ELEMENT_RECORD_STRIDE === 0 &&
            write.bytes.byteLength % ELEMENT_RECORD_STRIDE === 0,
        ),
      ).toBe(true);
      expect(
        writes.reduce((bytes, write) => bytes + write.bytes.byteLength, 0),
      ).toBeGreaterThanOrEqual(updates.length * ELEMENT_RECORD_STRIDE);
    } finally {
      restore();
    }
  });

  it("skips unchanged body records and writes one complete changed record", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [bodyUpdate(1, 2)]);
      const afterFirst = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, [bodyUpdate(1, 2)]);
      expect(gpu.writes.length).toBe(afterFirst);
      writeElementHighlights(gpu.device, storage, [bodyUpdate(1, 7)]);
      expect(
        gpu.writes.slice(afterFirst).map((write) => [write.offset, write.bytes.byteLength]),
      ).toEqual([[HIGHLIGHT_HEADER, ELEMENT_RECORD_STRIDE]]);
    } finally {
      restore();
    }
  });

  it("clears all highlight records when the emphasis list empties", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [elementUpdate(0, 0)]);
      const afterFirst = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, []);
      const tail = gpu.writes.slice(afterFirst);
      expect(tail).not.toHaveLength(0);
      const countBytes = new Uint32Array(tail[0]?.bytes.buffer ?? new ArrayBuffer(0))[0];
      expect(countBytes).toBe(0);
    } finally {
      restore();
    }
  });

  it("grows the buffer and keeps every record beyond the initial capacity", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) =>
        elementUpdate(index, index),
      );
      writeElementHighlights(gpu.device, storage, updates);
      const u32 = new Uint32Array(storage.highlight.data.buffer);
      expect(u32[0]).toBe(updates.length);
      const bucketCount = u32[1] ?? 0;
      expect(bucketCount).toBeGreaterThan(0);
      for (const update of updates) {
        let found = false;
        for (let index = 0; index < bucketCount * HIGHLIGHT_BUCKET_SIZE; index += 1) {
          const base = HIGHLIGHT_HEADER / 4 + index * (ELEMENT_RECORD_STRIDE / 4);
          if (u32[base] === update.slot && u32[base + 1] === update.elementPickId) {
            found = true;
            break;
          }
        }
        expect(found).toBe(true);
      }
      expect(gpu.buffers[0]?.destroyed).toBe(false);
      expect(gpu.buffers[1]?.size).toBeGreaterThan(
        HIGHLIGHT_HEADER + INITIAL_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE,
      );
    } finally {
      restore();
    }
  });

  it("allocates one exact GPU mirror for a collision-heavy 1,024-element layout", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const updates = Array.from({ length: 1_024 }, (_, elementId) => elementUpdate(0, elementId));

      writeElementHighlights(gpu.device, storage, updates);

      const table = new Uint32Array(storage.highlight.data.buffer);
      expect(table[0]).toBe(updates.length);
      expect(table[1]).toBe(1_024);
      expect(gpu.buffers).toHaveLength(2);
      expect(gpu.buffers[0]?.destroyed).toBe(false);
      expect(gpu.buffers[1]?.size).toBe(
        HIGHLIGHT_HEADER + 1_024 * HIGHLIGHT_BUCKET_SIZE * ELEMENT_RECORD_STRIDE,
      );
    } finally {
      restore();
    }
  });

  it("keeps the GPU bytes and CPU mirror identical when a populated table grows", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [elementUpdate(1, 1)]);
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) =>
        elementUpdate(index, index),
      );

      writeElementHighlights(gpu.device, storage, updates);

      const actual = new Uint8Array(storage.highlight.data.byteLength);
      for (const write of gpu.writes) {
        if (write.buffer === storage.highlight.buffer) actual.set(write.bytes, write.offset);
      }
      expect(actual).toEqual(storage.highlight.data);
    } finally {
      restore();
    }
  });

  it("invalidates every cached bind group when a box-sized selection grows the buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      storage.bindGroup = {} as GPUBindGroup;
      storage.nodeBindGroup = {} as GPUBindGroup;
      storage.edgeBindGroup = {} as GPUBindGroup;
      storage.transparentBindGroup = {} as GPUBindGroup;
      storage.selectionBindGroup = {} as GPUBindGroup;
      storage.subsetSelectionBindGroup = {} as GPUBindGroup;
      storage.nodeSelectionBindGroup = {} as GPUBindGroup;
      storage.subsetBindGroup = {} as GPUBindGroup;
      storage.subsetTransparentBindGroup = {} as GPUBindGroup;
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) =>
        elementUpdate(index, index),
      );
      writeElementHighlights(gpu.device, storage, updates);
      expect(storage.bindGroup).toBeUndefined();
      expect(storage.nodeBindGroup).toBeUndefined();
      expect(storage.edgeBindGroup).toBeUndefined();
      expect(storage.transparentBindGroup).toBeUndefined();
      expect(storage.selectionBindGroup).toBeUndefined();
      expect(storage.subsetSelectionBindGroup).toBeUndefined();
      expect(storage.nodeSelectionBindGroup).toBeUndefined();
      expect(storage.subsetBindGroup).toBeUndefined();
      expect(storage.subsetTransparentBindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("keeps diffing only changed subranges after the buffer grows", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const updates = Array.from({ length: INITIAL_ELEMENT_HIGHLIGHTS + 10 }, (_, index) =>
        elementUpdate(index, index),
      );
      writeElementHighlights(gpu.device, storage, updates);
      const afterGrowth = gpu.writes.length;
      writeElementHighlights(gpu.device, storage, updates);
      expect(gpu.writes.length).toBe(afterGrowth);
    } finally {
      restore();
    }
  });

  it("packs dense selected membership by occurrence and ordinal", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [], {
        selection: {
          elementCount: 65,
          occurrences: [
            { slot: 2, ordinals: [1, 33] },
            { slot: 5, ordinals: [65] },
          ],
        },
        selectedTheme: {
          color: { r: 0.9, g: 0.4, b: 0.1, a: 1 },
          emissive: 0.2,
          opacity: 0.8,
        },
        slotCapacity: 8,
      });
      const table = new Uint32Array(storage.highlight.data.buffer);
      const payload = HIGHLIGHT_HEADER / 4;
      const offsets = table[4] ?? 0;
      const bits = table[5] ?? 0;
      expect(table[3]).toBe(3);
      expect(table[6]).toBe(2);
      expect(table[7]).toBe(8);
      expect(table[payload + offsets + 2]).toBe(0);
      expect(table[payload + offsets + 5]).toBe(1);
      expect(table[payload + bits]).toBe(1);
      expect(table[payload + bits + 1]).toBe(1);
      expect(table[payload + bits + 5]).toBe(1 << 0);
      expect(table[8]).toBe(7);
    } finally {
      restore();
    }
  });

  it("does not repack unchanged dense membership for a sparse emphasis update", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      let iterations = 0;
      const ordinals = [1, 33];
      const iterate = ordinals[Symbol.iterator].bind(ordinals);
      Object.defineProperty(ordinals, Symbol.iterator, {
        value: () => {
          iterations += 1;
          return iterate();
        },
      });
      const selection = {
        elementCount: 65,
        occurrences: [{ slot: 2, ordinals }],
      };

      writeElementHighlights(gpu.device, storage, [], { selection, slotCapacity: 4 });
      writeElementHighlights(gpu.device, storage, [elementUpdate(2, 9)], {
        selection,
        slotCapacity: 4,
      });

      expect(iterations).toBe(1);
    } finally {
      restore();
    }
  });

  it("releases dense membership storage when selection clears", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      writeElementHighlights(gpu.device, storage, [], {
        selection: { elementCount: 2, occurrences: [{ slot: 1, ordinals: [2] }] },
        slotCapacity: 4,
      });
      const denseBuffer = storage.highlight.buffer;
      writeElementHighlights(gpu.device, storage, []);
      const table = new Uint32Array(storage.highlight.data.buffer);
      expect(table[6]).toBe(0);
      expect(storage.highlight.data.byteLength).toBe(HIGHLIGHT_HEADER + ELEMENT_RECORD_STRIDE);
      expect(storage.highlightOwned).toBe(false);
      expect(storage.highlight.selectionSlotCapacity).toBe(0);
      expect(storage.highlight.selectionRecordCapacity).toBe(0);
      expect(storage.highlight.selectionWordCapacity).toBe(0);
      expect(gpu.buffers.find((buffer) => buffer.resource === denseBuffer)?.destroyed).toBe(true);
    } finally {
      restore();
    }
  });
});
