import { describe, expect, it } from "vitest";
import { createBuffer } from "../../src/renderer/gpu-support";
import { createInteractionState } from "../../src/interaction/interaction";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";
import { readInteractionState } from "../../src/interaction/state";

describe("GPU support helpers", () => {
  it("creates an empty interaction state with all overrides unset", () => {
    const state = createInteractionState();
    const data = readInteractionState(state);
    expect(data.highlightedPartIds.size).toBe(0);
    expect(data.highlightedInstanceIds.size).toBe(0);
    expect(data.selectedPartIds.size).toBe(0);
    expect(data.selectedInstanceIds.size).toBe(0);
    expect(data.partOverrides.size).toBe(0);
    expect(data.instanceOverrides.size).toBe(0);
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
