import { describe, expect, it } from "vitest";
import { createBuffer, createDefaultInteraction } from "../../src/renderer/gpu-support";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("GPU support helpers", () => {
  it("creates an empty interaction state with all overrides unset", () => {
    const state = createDefaultInteraction();
    expect(state.highlightedPartIds.size).toBe(0);
    expect(state.highlightedInstanceIds.size).toBe(0);
    expect(state.selectedPartIds.size).toBe(0);
    expect(state.selectedInstanceIds.size).toBe(0);
    expect(state.partOverrides.size).toBe(0);
    expect(state.instanceOverrides.size).toBe(0);
  });

  it("creates and uploads a GPU buffer with copy usage", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const buffer = createBuffer(gpu.device, new Float32Array([1, 2, 3]), GPUBufferUsage.VERTEX);
      expect(buffer).toBeDefined();
      expect(gpu.buffers).toHaveLength(1);
      expect(gpu.buffers[0]?.size).toBe(12);
      expect(gpu.writes[0]?.bytes.byteLength).toBe(12);
    } finally {
      restore();
    }
  });
});
