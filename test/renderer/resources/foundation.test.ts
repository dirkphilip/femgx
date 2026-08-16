import { describe, expect, it } from "vitest";
import { createBuffer } from "../../../src/renderer/resources/foundation";
import { createInteractionState } from "../../../src/interaction/interaction";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";
import { readInteractionState } from "../../../src/interaction/state";

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
});
