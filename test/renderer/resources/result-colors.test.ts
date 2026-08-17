import { describe, expect, it } from "vitest";
import {
  createEmptyResultColorBuffer,
  syncResultColors,
  type ResultColorDrawResources,
  type ResultColorStorage,
} from "../../../src/renderer/resources/result-colors";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

type TestInstanceStorage = {
  bindGroup: GPUBindGroup | undefined;
  edgeBindGroup: GPUBindGroup | undefined;
};

describe("dense result color storage", () => {
  it("uploads one location-tagged table and skips its unchanged identity", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const sync = syncOwner(gpu.device);
      const table = {
        location: "elemental" as const,
        values: new Float32Array([0, 0, 0, 0, 1, 0.5, 0.25, 1]),
      };
      syncResultColors(sync, new Map([[7, table]]));
      const storage = sync.resultColors.get(7);
      const write = gpu.writes.find((candidate) => candidate.buffer === storage?.buffer);
      expect(storage?.source).toBe(table);
      expect(storage?.buffer.size).toBe(48);
      expect(write?.source).toEqual(new Float32Array([1, 2, 0, 0, 0, 0, 0, 0, 1, 0.5, 0.25, 1]));
      const writes = gpu.writes.length;
      syncResultColors(sync, new Map([[7, table]]));
      expect(gpu.writes).toHaveLength(writes);
    } finally {
      restore();
    }
  });

  it("releases removed tables and invalidates cached part bindings", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const sync = syncOwner(gpu.device);
      const instance = {
        bindGroup: {} as GPUBindGroup,
        edgeBindGroup: {} as GPUBindGroup,
      };
      sync.storages.set(3, instance);
      syncResultColors(sync, new Map([[3, { location: "nodal", values: new Float32Array(8) }]]));
      const buffer = sync.resultColors.get(3)?.buffer;
      syncResultColors(sync, undefined);
      expect(sync.resultColors.size).toBe(0);
      expect(instance.bindGroup).toBeUndefined();
      expect(instance.edgeBindGroup).toBeUndefined();
      expect(gpu.buffers.find((candidate) => candidate.resource === buffer)?.destroyed).toBe(true);
    } finally {
      restore();
    }
  });
});

function syncOwner(
  device: GPUDevice,
): ResultColorDrawResources & { readonly storages: Map<number, TestInstanceStorage> } {
  return {
    device,
    resultColors: new Map<number, ResultColorStorage>(),
    emptyResultColorBuffer: createEmptyResultColorBuffer(device),
    storages: new Map<number, TestInstanceStorage>(),
  };
}
