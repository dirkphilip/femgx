import { describe, expect, it } from "vitest";
import {
  destroyDeformationBuffers,
  ensureDeformationBuffer,
  syncDeformations,
  validateDeformation,
  writeDeformationUniform,
  type DeformationStorage,
  type DeformationSync,
} from "@/renderer/frame/deformation";
import type { DeformationState } from "@/results/deform";
import { directBufferWritePort } from "@/renderer/resources/buffer-write-port";
import { fakeGpuDevice, installGpuGlobals, type FakeGpu } from "../fake-gpu";

type StorageMap = Map<
  number,
  {
    bindGroup: GPUBindGroup | undefined;
    nodeBindGroup?: GPUBindGroup | undefined;
    edgeBindGroup: GPUBindGroup | undefined;
    transparentBindGroup?: GPUBindGroup | undefined;
    selectionBindGroup?: GPUBindGroup | undefined;
    subsetSelectionBindGroup?: GPUBindGroup | undefined;
    nodeSelectionBindGroup?: GPUBindGroup | undefined;
    subsetBindGroup?: GPUBindGroup | undefined;
    subsetTransparentBindGroup?: GPUBindGroup | undefined;
  }
>;

function state(
  overrides: Partial<Pick<DeformationState, "scale">> & Pick<DeformationState, "displacements">,
): DeformationState {
  return {
    scale: overrides.scale ?? 1,
    displacements: overrides.displacements,
  };
}

function syncWith(gpu: FakeGpu): { sync: DeformationSync; storages: StorageMap } {
  const storages: StorageMap = new Map();
  return {
    sync: {
      device: gpu.device,
      writePort: directBufferWritePort(gpu.device),
      deformations: new Map(),
      storages,
    },
    storages,
  };
}

describe("validateDeformation", () => {
  it("rejects displacement buffers that do not contain whole vec3 values", () => {
    const displacements = new Map<number, Float32Array>([[1, new Float32Array(5)]]);
    expect(() => {
      validateDeformation(state({ displacements }));
    }).toThrow(/not a multiple of 3/);
  });

  it("accepts a valid nodal state", () => {
    const displacements = new Map<number, Float32Array>([[1, new Float32Array(2 * 3)]]);
    expect(() => {
      validateDeformation(state({ displacements }));
    }).not.toThrow();
  });
});

describe("syncDeformations", () => {
  it("uploads a displacement buffer per part and records its source", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync } = syncWith(gpu);
      const values = new Float32Array([1, 2, 3, 4, 5, 6]);
      syncDeformations(sync, {
        scale: 1,
        displacements: new Map([[1, values]]),
      });
      const storage = sync.deformations.get(1);
      expect(storage).toBeDefined();
      expect(storage?.source).toEqual([values]);
      expect(gpu.buffers.at(-1)?.size).toBe(36);
      expect(gpu.writes.some((write) => write.buffer === storage?.buffer)).toBe(true);
    } finally {
      restore();
    }
  });

  it("treats an undefined state as the disabled identityMatrix", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync } = syncWith(gpu);
      syncDeformations(sync, undefined);
      expect(sync.deformations.size).toBe(0);
      expect(gpu.writes).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("skips arrays already uploaded for the same source", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync } = syncWith(gpu);
      const deformation: DeformationState = {
        scale: 1,
        displacements: new Map([[1, new Float32Array([1, 2, 3])]]),
      };
      syncDeformations(sync, deformation);
      const afterFirst = gpu.writes.length;
      syncDeformations(sync, deformation);
      expect(gpu.writes.length).toBe(afterFirst);
    } finally {
      restore();
    }
  });

  it("rewrites a new array into the existing buffer without clearing the bind group", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync, storages } = syncWith(gpu);
      syncDeformations(sync, {
        scale: 1,
        displacements: new Map([[1, new Float32Array([1, 2, 3])]]),
      });
      storages.set(1, {
        bindGroup: {} as GPUBindGroup,
        nodeBindGroup: {} as GPUBindGroup,
        edgeBindGroup: {} as GPUBindGroup,
        transparentBindGroup: {} as GPUBindGroup,
        selectionBindGroup: {} as GPUBindGroup,
        subsetSelectionBindGroup: {} as GPUBindGroup,
        nodeSelectionBindGroup: {} as GPUBindGroup,
        subsetBindGroup: {} as GPUBindGroup,
        subsetTransparentBindGroup: {} as GPUBindGroup,
      });
      const before = gpu.buffers.length;
      const next = new Float32Array([4, 5, 6]);
      syncDeformations(sync, {
        scale: 1,
        displacements: new Map([[1, next]]),
      });
      expect(gpu.buffers.length).toBe(before);
      expect(sync.deformations.get(1)?.source).toEqual([next]);
      expect(storages.get(1)?.bindGroup).toBeDefined();
      expect(storages.get(1)?.edgeBindGroup).toBeDefined();
    } finally {
      restore();
    }
  });

  it("recreates the buffer and clears both bind groups when it must grow", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync, storages } = syncWith(gpu);
      const deformation = (length: number): DeformationState => ({
        scale: 1,
        displacements: new Map([[1, new Float32Array(length)]]),
      });
      syncDeformations(sync, deformation(3));
      storages.set(1, {
        bindGroup: {} as GPUBindGroup,
        nodeBindGroup: {} as GPUBindGroup,
        edgeBindGroup: {} as GPUBindGroup,
        transparentBindGroup: {} as GPUBindGroup,
        selectionBindGroup: {} as GPUBindGroup,
        subsetSelectionBindGroup: {} as GPUBindGroup,
        nodeSelectionBindGroup: {} as GPUBindGroup,
        subsetBindGroup: {} as GPUBindGroup,
        subsetTransparentBindGroup: {} as GPUBindGroup,
      });
      const old = gpu.buffers.at(-1);
      syncDeformations(sync, deformation(6));
      const current = gpu.buffers.at(-1);
      expect(current).not.toBe(old);
      expect(old?.destroyed).toBe(true);
      expect(storages.get(1)?.bindGroup).toBeUndefined();
      expect(storages.get(1)?.nodeBindGroup).toBeUndefined();
      expect(storages.get(1)?.edgeBindGroup).toBeUndefined();
      expect(storages.get(1)?.transparentBindGroup).toBeUndefined();
      expect(storages.get(1)?.selectionBindGroup).toBeUndefined();
      expect(storages.get(1)?.subsetSelectionBindGroup).toBeUndefined();
      expect(storages.get(1)?.nodeSelectionBindGroup).toBeUndefined();
      expect(storages.get(1)?.subsetBindGroup).toBeUndefined();
      expect(storages.get(1)?.subsetTransparentBindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("recreates the buffer when a smaller array replaces a larger one", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync, storages } = syncWith(gpu);
      syncDeformations(sync, {
        scale: 1,
        displacements: new Map([[1, new Float32Array(2 * 3 * 3)]]),
      });
      storages.set(1, {
        bindGroup: {} as GPUBindGroup,
        nodeBindGroup: {} as GPUBindGroup,
        edgeBindGroup: {} as GPUBindGroup,
        transparentBindGroup: {} as GPUBindGroup,
        selectionBindGroup: {} as GPUBindGroup,
        nodeSelectionBindGroup: {} as GPUBindGroup,
      });
      const old = gpu.buffers.at(-1);
      syncDeformations(sync, {
        scale: 1,
        displacements: new Map([[1, new Float32Array(3 * 3)]]),
      });
      const current = gpu.buffers.at(-1);
      expect(current).not.toBe(old);
      expect(current?.size).toBe(48);
      expect(old?.destroyed).toBe(true);
      expect(storages.get(1)?.bindGroup).toBeUndefined();
      expect(storages.get(1)?.nodeBindGroup).toBeUndefined();
      expect(storages.get(1)?.selectionBindGroup).toBeUndefined();
      expect(storages.get(1)?.nodeSelectionBindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("destroys buffers and clears bind groups for parts dropped from the state", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync, storages } = syncWith(gpu);
      const deformation = (partIds: readonly number[]): DeformationState => ({
        scale: 1,
        displacements: new Map(partIds.map((partId) => [partId, new Float32Array(3)])),
      });
      syncDeformations(sync, deformation([1, 2]));
      storages.set(1, {
        bindGroup: {} as GPUBindGroup,
        nodeBindGroup: {} as GPUBindGroup,
        edgeBindGroup: {} as GPUBindGroup,
        transparentBindGroup: {} as GPUBindGroup,
        selectionBindGroup: {} as GPUBindGroup,
        nodeSelectionBindGroup: {} as GPUBindGroup,
      });
      const droppedBuffer = sync.deformations.get(1)?.buffer;
      const droppedRecord = gpu.buffers.find((buffer) => buffer.resource === droppedBuffer);
      syncDeformations(sync, deformation([2]));
      expect(sync.deformations.has(1)).toBe(false);
      expect(sync.deformations.has(2)).toBe(true);
      expect(droppedRecord?.destroyed).toBe(true);
      expect(storages.get(1)?.bindGroup).toBeUndefined();
      expect(storages.get(1)?.nodeBindGroup).toBeUndefined();
      expect(storages.get(1)?.edgeBindGroup).toBeUndefined();
      expect(storages.get(1)?.transparentBindGroup).toBeUndefined();
      expect(storages.get(1)?.selectionBindGroup).toBeUndefined();
      expect(storages.get(1)?.nodeSelectionBindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("deduplicates shared displacement rows around one occurrence override", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync } = syncWith(gpu);
      const shared = new Float32Array([1, 2, 3]);
      const override = new Float32Array([4, 5, 6]);
      const runtime = {
        sortedPartIds: new Uint32Array([1]),
        getInstanceSlot: (id: string) => (id === "1/right" ? 1 : undefined),
        getPartId: () => 1,
      } as never;
      const layout = {
        slotPartLocal: new Int32Array([0, 1, 2]),
        partLocalSlots: new Map([[1, new Int32Array([0, 1, 2])]]),
      };
      syncDeformations(
        sync,
        state({
          displacements: new Map([
            [1, shared],
            ["1/right" as never, override],
          ]),
        }),
        runtime,
        layout,
      );

      const storage = sync.deformations.get(1);
      const write = gpu.writes.find((candidate) => candidate.buffer === storage?.buffer);
      const words = new Uint32Array(write?.bytes.buffer ?? new ArrayBuffer(0));
      expect(storage?.source).toEqual([shared, override, shared]);
      expect(Array.from(words.slice(0, 4))).toEqual([3, 4, 8, 4]);
      expect(storage?.buffer.size).toBe(48);
    } finally {
      restore();
    }
  });
});

describe("writeDeformationUniform", () => {
  it("writes scale and leaves alignment padding zeroed", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const buffer = gpu.device.createBuffer({ size: 16, usage: 1 });
      writeDeformationUniform(gpu.device, buffer, {
        scale: 2.5,
        displacements: new Map(),
      });
      const write = gpu.writes.find((entry) => entry.buffer === buffer);
      const bytes = write?.bytes ?? new Uint8Array();
      const floats = new Float32Array(bytes.buffer, bytes.byteOffset, 4);
      const ids = new Uint32Array(bytes.buffer, bytes.byteOffset, 4);
      expect(floats[0]).toBe(2.5);
      expect(ids[1]).toBe(0);
      expect(ids[2]).toBe(0);
    } finally {
      restore();
    }
  });

  it("writes a disabled uniform for an undefined state", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const buffer = gpu.device.createBuffer({ size: 16, usage: 1 });
      writeDeformationUniform(gpu.device, buffer, undefined);
      const write = gpu.writes.find((entry) => entry.buffer === buffer);
      const ids = new Uint32Array(write?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
      expect(ids[1]).toBe(0);
      expect(ids[2]).toBe(0);
    } finally {
      restore();
    }
  });
});

describe("ensureDeformationBuffer", () => {
  it("creates an empty buffer for parts without displacement data", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const deformations = new Map<number, DeformationStorage>();
      const buffer = ensureDeformationBuffer(gpu.device, deformations, 1);
      expect(buffer).toBeDefined();
      expect(gpu.buffers.at(-1)?.size).toBe(4);
    } finally {
      restore();
    }
  });

  it("reuses an existing deformation buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const deformations = new Map<number, DeformationStorage>();
      const first = ensureDeformationBuffer(gpu.device, deformations, 1);
      const second = ensureDeformationBuffer(gpu.device, deformations, 1);
      expect(second).toBe(first);
      expect(gpu.buffers).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("destroyDeformationBuffers", () => {
  it("destroys every per-part buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync } = syncWith(gpu);
      syncDeformations(sync, {
        scale: 1,
        displacements: new Map([[1, new Float32Array([1, 2, 3])]]),
      });
      destroyDeformationBuffers(sync.deformations);
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      restore();
    }
  });
});
