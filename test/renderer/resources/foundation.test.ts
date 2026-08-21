import { describe, expect, it } from "vitest";
import { createBuffer } from "@/renderer/resources/foundation";
import { createInteractionState } from "@/interaction/interaction";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";
import { readInteractionState } from "@/interaction/state";

describe("GPU support helpers", () => {
  it("creates an empty interaction state with all overrides unset", () => {
    const state = createInteractionState();
    const data = readInteractionState(state);
    expect(data.highlightedPartIds.size).toBe(0);
    expect(data.highlightedPartOccurrenceIds.size).toBe(0);
    expect(data.selectedPartIds.size).toBe(0);
    expect(data.selectedPartOccurrenceIds.size).toBe(0);
    expect(data.partOverrides.size).toBe(0);
    expect(data.partOccurrenceOverrides.size).toBe(0);
  });

  it("uploads the source view without an intermediate staging copy", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const data = new Float32Array([1, 2, 3]);
      const buffer = createBuffer(gpu.device, data, GPUBufferUsage.VERTEX);
      expect(buffer).toBeDefined();
      expect(gpu.buffers).toHaveLength(1);
      expect(gpu.buffers[0]?.size).toBe(12);
      expect(gpu.writes[0]?.bytes.byteLength).toBe(12);
      expect(gpu.writes[0]?.source).toBe(data);
    } finally {
      restore();
    }
  });

  it("rejects storage bindings that exceed the active device limit", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ maxStorageBufferBindingSize: 8 });
      expect(() =>
        createBuffer(
          gpu.device,
          new Uint32Array([1, 2, 3]),
          GPUBufferUsage.STORAGE,
          "selection replay",
        ),
      ).toThrow("selection replay: 12 bytes exceeds device maxStorageBufferBindingSize 8");
      expect(gpu.buffers).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
