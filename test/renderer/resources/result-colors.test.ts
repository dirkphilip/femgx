import { describe, expect, it } from "vitest";
import {
  createEmptyResultColorBuffer,
  syncResultColors,
  type ResultColorDrawResources,
  type ResultColorStorage,
} from "@/renderer/resources/result-colors";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

type TestInstanceStorage = {
  bindGroup: GPUBindGroup | undefined;
  edgeBindGroup: GPUBindGroup | undefined;
};

describe("dense result color storage", () => {
  it("uploads one location-tagged table and skips its unchanged identityMatrix", () => {
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
      expect(storage?.source).toEqual([table]);
      expect(storage?.buffer.size).toBe(56);
      const words = new Uint32Array(write?.bytes.buffer ?? new ArrayBuffer(0));
      const floats = new Float32Array(write?.bytes.buffer ?? new ArrayBuffer(0));
      expect(Array.from(words.slice(0, 2))).toEqual([1, 2]);
      expect(floats.slice(2)).toEqual(new Float32Array([1, 2, 0, 0, 0, 0, 0, 0, 1, 0.5, 0.25, 1]));
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

  it("packs shared tables once and addresses occurrence overrides by part-local slot", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const sync = syncOwner(gpu.device);
      const shared = { location: "elemental" as const, values: new Float32Array(8) };
      const override = { location: "elemental" as const, values: new Float32Array(8).fill(1) };
      const runtime = {
        sortedPartIds: new Uint32Array([7]),
        getInstanceSlot: (id: string) => (id === "1/right" ? 1 : undefined),
        getPartId: () => 7,
      } as never;
      const layout = {
        slotPartLocal: new Int32Array([0, 1, 2]),
        partLocalSlots: new Map([[7, new Int32Array([0, 1, 2])]]),
      };
      syncResultColors(
        sync,
        new Map([
          [7, shared],
          ["1/right" as never, override],
        ]),
        runtime,
        layout,
      );

      const storage = sync.resultColors.get(7);
      const write = gpu.writes.find((candidate) => candidate.buffer === storage?.buffer);
      const words = new Uint32Array(write?.bytes.buffer ?? new ArrayBuffer(0));
      expect(storage?.source).toEqual([shared, override, shared]);
      expect(Array.from(words.slice(0, 4))).toEqual([3, 4, 16, 4]);
      expect(storage?.buffer.size).toBe(112);
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
