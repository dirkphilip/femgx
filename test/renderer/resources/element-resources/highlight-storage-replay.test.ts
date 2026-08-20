import { describe, expect, it } from "vitest";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  elementUpdate,
  fakeGpuDevice,
  installGpuGlobals,
  makeStorage,
  writeElementHighlights,
} from "./support";

describe("dense highlight GPU replay", () => {
  it("stores broad hidden membership as one ordinal bitset", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const elementCount = 131_712;
      writeElementHighlights(gpu.device, storage, [], {
        visibility: denseSelection(
          0,
          new Uint32Array(Math.ceil(elementCount / 32)).fill(0xffffffff),
        ),
        slotCapacity: 1,
      });

      expect(storage.highlight.sparseCapacity).toBe(1);
      expect(storage.highlight.buffer.size).toBe(
        HIGHLIGHT_HEADER +
          ELEMENT_RECORD_STRIDE +
          2 * Uint32Array.BYTES_PER_ELEMENT +
          elementCount / 8,
      );
    } finally {
      restore();
    }
  });

  it("reconstructs selection, visibility, and node membership through storage changes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const storage = makeStorage(gpu);
      const selection = denseSelection(2, [1, 1]);
      const visibility = denseSelection(1, [2, 8]);
      const nodeSelection = denseSelection(3, [1, 4]);
      writeElementHighlights(gpu.device, storage, [], {
        selection,
        visibility,
        nodeSelection,
        slotCapacity: 4,
      });
      expectGpuMirror(gpu, storage.highlight);

      const firstBuffer = storage.highlight.buffer;
      writeElementHighlights(gpu.device, storage, [elementUpdate(2, 9)], {
        selection,
        visibility,
        nodeSelection,
        slotCapacity: 4,
      });
      expect(storage.highlight.buffer).not.toBe(firstBuffer);
      expect(storage.highlight.denseSelection).toBe(selection);
      expect(storage.highlight.denseVisibility).toBe(visibility);
      expect(storage.highlight.denseNodeSelection).toBe(nodeSelection);
      const payloadOffset =
        HIGHLIGHT_HEADER + storage.highlight.sparseCapacity * ELEMENT_RECORD_STRIDE;
      expect(
        gpu.writes.filter(
          (write) => write.buffer === storage.highlight.buffer && write.offset === payloadOffset,
        ),
      ).toHaveLength(1);
      expectDenseMirror(storage.highlight.data, selection, visibility, nodeSelection);
      expectGpuMirror(gpu, storage.highlight);

      writeElementHighlights(gpu.device, storage, [], {
        visibility,
        nodeSelection,
        slotCapacity: 4,
      });
      expect(storage.highlight.denseSelection).toBeUndefined();
      expect(storage.highlight.denseNodeSelection).toBe(nodeSelection);
      expect(storage.highlight.denseVisibility).toBe(visibility);
      expectDenseMirror(storage.highlight.data, undefined, visibility, nodeSelection);
      expectGpuMirror(gpu, storage.highlight);

      const releasedBuffer = storage.highlight.buffer;
      writeElementHighlights(gpu.device, storage, []);
      expect(storage.highlightOwned).toBe(false);
      expect(gpu.buffers.find((buffer) => buffer.resource === releasedBuffer)?.destroyed).toBe(
        true,
      );
      expect(gpu.writes.at(-1)?.bytes.byteLength).toBe(Uint32Array.BYTES_PER_ELEMENT * 4);

      writeElementHighlights(gpu.device, storage, [], {
        selection,
        visibility,
        nodeSelection,
        slotCapacity: 4,
      });
      expect(storage.highlightOwned).toBe(true);
      expectDenseMirror(storage.highlight.data, selection, visibility, nodeSelection);
      expectGpuMirror(gpu, storage.highlight);
    } finally {
      restore();
    }
  });
});

function denseSelection(slot: number, words: ArrayLike<number>) {
  return {
    elementCount: words.length * 32,
    nodeCount: words.length * 32,
    occurrences: [{ slot, selectedCount: 2, words: new Uint32Array(words) }],
  };
}

function expectDenseMirror(
  data: Uint8Array,
  selection:
    | { readonly occurrences: readonly { readonly slot: number; readonly words: Uint32Array }[] }
    | undefined,
  visibility:
    | { readonly occurrences: readonly { readonly slot: number; readonly words: Uint32Array }[] }
    | undefined,
  nodeSelection:
    | { readonly occurrences: readonly { readonly slot: number; readonly words: Uint32Array }[] }
    | undefined,
): void {
  const values = new Uint32Array(data.buffer);
  const payload = HIGHLIGHT_HEADER / 4;
  const elementOffset = values[4] ?? 0;
  const elementBits = values[5] ?? 0;
  const nodeOffset = values[16] ?? 0;
  const nodeBits = values[17] ?? 0;
  const visibilityOffset = values[21] ?? 0;
  const visibilityBits = values[22] ?? 0;
  expect(values[payload + elementOffset + (selection?.occurrences[0]?.slot ?? 0)]).toBe(
    selection === undefined ? 0xffffffff : 0,
  );
  if (selection !== undefined) {
    expect(values[payload + elementBits]).toBe(selection.occurrences[0]?.words[0]);
  }
  expect(values[payload + visibilityOffset + (visibility?.occurrences[0]?.slot ?? 0)]).toBe(
    visibility === undefined ? 0xffffffff : 0,
  );
  if (visibility !== undefined) {
    expect(values[payload + visibilityBits]).toBe(visibility.occurrences[0]?.words[0]);
  }
  expect(values[payload + nodeOffset + (nodeSelection?.occurrences[0]?.slot ?? 0)]).toBe(
    nodeSelection === undefined ? 0xffffffff : 0,
  );
  if (nodeSelection !== undefined) {
    expect(values[payload + nodeBits]).toBe(nodeSelection.occurrences[0]?.words[0]);
  }
}

function expectGpuMirror(
  gpu: ReturnType<typeof fakeGpuDevice>,
  storage: { readonly buffer: GPUBuffer; readonly data: Uint8Array },
): void {
  const replay = new Uint8Array(storage.data.byteLength);
  for (const write of gpu.writes) {
    if (write.buffer === storage.buffer) replay.set(write.bytes, write.offset);
  }
  expect(replay).toEqual(storage.data);
}
