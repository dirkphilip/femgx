import { expect, it, describe } from "vitest";
import {
  createDrawResources,
  destroyDrawResources,
  patchInstances,
  writeDrawOrder,
  writeEdgeOrder,
  writeTransparentOrder,
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  fakeGpuDevice,
  installGpuGlobals,
  part,
  record,
  writeRanges,
} from "./support";

describe("GPU draw path", () => {
  it.each([1, 100, 1000])(
    "keeps empty optional residency fixed for %s bodyless parts",
    (partCount) => {
      const restore = installGpuGlobals();
      try {
        const gpu = fakeGpuDevice();
        const draw = createDrawResources(gpu.device);
        for (let partId = 1; partId <= partCount; partId += 1) {
          patchInstances(draw, partId, [{ slot: 0, data: record(0) }]);
          writeDrawOrder(draw, partId, new Uint32Array([0]));
        }
        expect(gpu.buffers.reduce((bytes, buffer) => bytes + buffer.size, 0)).toBe(
          HIGHLIGHT_HEADER + ELEMENT_RECORD_STRIDE + 8 + partCount * (96 + 4),
        );
        expect(
          [...draw.storages.values()].every(
            (storage) =>
              storage.sidecars.transparent === undefined &&
              storage.sidecars.selection === undefined &&
              storage.sidecars.nodeSelection === undefined &&
              storage.sidecars.edge === undefined &&
              storage.sidecars.node === undefined &&
              !storage.highlightOwned,
          ),
        ).toBe(true);
      } finally {
        restore();
      }
    },
  );

  it("admits and releases an optional order sidecar independently of core capacity", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 99, data: record(1) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([99]));
      const storage = draw.storages.get(part.id);
      expect(storage?.capacity).toBe(100);
      expect(storage?.sidecars.transparent).toBeUndefined();
      expect(storage?.sidecars.selection).toBeUndefined();
      expect(storage?.sidecars.edge).toBeUndefined();
      expect(storage?.highlightOwned).toBe(false);
      expect(gpu.buffers).toHaveLength(5);

      writeTransparentOrder(draw, part.id, new Uint32Array([0, 1]));
      const transparent = storage?.sidecars.transparent;
      expect(transparent?.capacity).toBe(2);
      expect(transparent?.buffer.size).toBe(8);
      expect(gpu.buffers).toHaveLength(6);

      writeTransparentOrder(draw, part.id, new Uint32Array());
      expect(storage?.sidecars.transparent).toBeUndefined();
      expect(gpu.buffers.at(-1)?.destroyed).toBe(true);
      expect(draw.cost.snapshot().memory.bindGroupInvalidations).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("destroys shared, core, and active sidecar buffers exactly once", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 2, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      writeTransparentOrder(draw, part.id, new Uint32Array([2]));
      destroyDrawResources(draw);
      destroyDrawResources(draw);
      expect(gpu.buffers.every((buffer) => buffer.destroyCount === 1)).toBe(true);
    } finally {
      restore();
    }
  });

  it("rewrites only the changed draw-order entries", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const afterInitial = gpu.writes.length;
      writeDrawOrder(draw, part.id, new Uint32Array([0, 2]));
      expect(writeRanges(gpu, afterInitial)).toEqual([[4, 8]]);
    } finally {
      restore();
    }
  });

  it("writes the edge overlay order to its own buffer, diffed like the surface order", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const afterInitial = gpu.writes.length;
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      expect(gpu.writes.length).toBe(afterInitial);
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 2]));
      expect(writeRanges(gpu, afterInitial)).toEqual([[4, 8]]);
    } finally {
      restore();
    }
  });
});
