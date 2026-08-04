import { describe, expect, it } from "vitest";
import {
  defaultDeformation,
  destroyDeformationBuffers,
  ensureDeformationBuffer,
  syncDeformations,
  validateDeformation,
  writeDeformationUniform,
  type DeformationState,
  type DeformationStorage,
  type DeformationSync,
} from "../../src/renderer/gpu-deform";
import { fakeGpuDevice, installGpuGlobals, type FakeGpu } from "./fake-gpu";

type StorageMap = Map<number, { bindGroup: GPUBindGroup | undefined }>;

function state(
  overrides: Partial<Pick<DeformationState, "scale" | "loadCase" | "loadCaseCount">> &
    Pick<DeformationState, "displacements">,
): DeformationState {
  return {
    scale: overrides.scale ?? 1,
    loadCase: overrides.loadCase ?? 0,
    loadCaseCount: overrides.loadCaseCount ?? 0,
    displacements: overrides.displacements,
  };
}

function syncWith(gpu: FakeGpu): { sync: DeformationSync; storages: StorageMap } {
  const storages: StorageMap = new Map();
  return {
    sync: { device: gpu.device, deformations: new Map(), storages },
    storages,
  };
}

describe("validateDeformation", () => {
  it("rejects a non-integer or negative load case count", () => {
    expect(() => {
      validateDeformation(state({ loadCaseCount: -1, displacements: new Map() }));
    }).toThrow(/loadCaseCount/);
    expect(() => {
      validateDeformation(state({ loadCaseCount: 1.5, displacements: new Map() }));
    }).toThrow(/loadCaseCount/);
  });

  it("rejects an active load case outside the stored cases", () => {
    expect(() => {
      validateDeformation(state({ loadCaseCount: 2, loadCase: 2, displacements: new Map() }));
    }).toThrow(/out of range/);
    expect(() => {
      validateDeformation(state({ loadCaseCount: 2, loadCase: -1, displacements: new Map() }));
    }).toThrow(/out of range/);
  });

  it("rejects displacement buffers not divisible by loadCaseCount * 3", () => {
    const displacements = new Map<number, Float32Array>([[1, new Float32Array(5)]]);
    expect(() => {
      validateDeformation(state({ loadCaseCount: 2, displacements }));
    }).toThrow(/not a multiple of 6/);
  });

  it("accepts a valid multi-case state", () => {
    const displacements = new Map<number, Float32Array>([[1, new Float32Array(2 * 2 * 3)]]);
    expect(() => {
      validateDeformation(state({ loadCaseCount: 2, loadCase: 1, displacements }));
    }).not.toThrow();
  });
});

describe("defaultDeformation", () => {
  it("disables deformation with an empty displacement map", () => {
    expect(defaultDeformation.loadCaseCount).toBe(0);
    expect(defaultDeformation.displacements.size).toBe(0);
    expect(() => {
      validateDeformation(defaultDeformation);
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
        loadCase: 0,
        loadCaseCount: 1,
        displacements: new Map([[1, values]]),
      });
      const storage = sync.deformations.get(1);
      expect(storage).toBeDefined();
      expect(storage?.source).toBe(values);
      expect(gpu.buffers.at(-1)?.size).toBe(24);
      expect(gpu.writes.some((write) => write.buffer === storage?.buffer)).toBe(true);
    } finally {
      restore();
    }
  });

  it("treats an undefined state as the disabled identity", () => {
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
        loadCase: 0,
        loadCaseCount: 1,
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
        loadCase: 0,
        loadCaseCount: 1,
        displacements: new Map([[1, new Float32Array([1, 2, 3])]]),
      });
      storages.set(1, { bindGroup: {} as GPUBindGroup });
      const before = gpu.buffers.length;
      const next = new Float32Array([4, 5, 6]);
      syncDeformations(sync, {
        scale: 1,
        loadCase: 0,
        loadCaseCount: 1,
        displacements: new Map([[1, next]]),
      });
      expect(gpu.buffers.length).toBe(before);
      expect(sync.deformations.get(1)?.source).toBe(next);
      expect(storages.get(1)?.bindGroup).toBeDefined();
    } finally {
      restore();
    }
  });

  it("recreates the buffer and clears the bind group when it must grow", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const { sync, storages } = syncWith(gpu);
      const deformation = (length: number): DeformationState => ({
        scale: 1,
        loadCase: 0,
        loadCaseCount: length === 3 ? 1 : 2,
        displacements: new Map([[1, new Float32Array(length)]]),
      });
      syncDeformations(sync, deformation(3));
      storages.set(1, { bindGroup: {} as GPUBindGroup });
      const old = gpu.buffers.at(-1);
      syncDeformations(sync, deformation(6));
      const current = gpu.buffers.at(-1);
      expect(current).not.toBe(old);
      expect(old?.destroyed).toBe(true);
      expect(storages.get(1)?.bindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe("writeDeformationUniform", () => {
  it("writes scale, load case, and load case count at the documented offsets", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const buffer = gpu.device.createBuffer({ size: 16, usage: 1 });
      writeDeformationUniform(gpu.device, buffer, {
        scale: 2.5,
        loadCase: 1,
        loadCaseCount: 2,
        displacements: new Map(),
      });
      const write = gpu.writes.find((entry) => entry.buffer === buffer);
      const bytes = write?.bytes ?? new Uint8Array();
      const floats = new Float32Array(bytes.buffer, bytes.byteOffset, 4);
      const ids = new Uint32Array(bytes.buffer, bytes.byteOffset, 4);
      expect(floats[0]).toBe(2.5);
      expect(ids[1]).toBe(1);
      expect(ids[2]).toBe(2);
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
        loadCase: 0,
        loadCaseCount: 1,
        displacements: new Map([[1, new Float32Array([1, 2, 3])]]),
      });
      destroyDeformationBuffers(sync.deformations);
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      restore();
    }
  });
});
