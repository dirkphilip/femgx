import { expect, it, describe } from "vitest";
import {
  translationMatrix,
  createDrawResources,
  encodeInstanceRecord,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_SELECTED_FLAG,
  patchInstances,
  defaultStyle,
  fakeGpuDevice,
  installGpuGlobals,
  syncInstanceEmphasisAdmission,
  part,
  record,
  denseRecord,
  instanceWrites,
  writeRanges,
  type DenseElementSelections,
} from "./support";

describe("GPU draw path", () => {
  it("admits only occurrences with primitive emphasis and clears stale admission", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
      ]);
      const update = (slot: number) => ({
        slot,
        elementPickId: 1,
        facePickId: 0,
        nodePickId: 0,
        style: defaultStyle,
      });
      const emphasized = new Map([[part.id, [update(1)]]]);
      syncInstanceEmphasisAdmission(draw, emphasized, new Set([part.id]));
      const storage = draw.storages.get(part.id);
      expect(storage).toBeDefined();
      const flags = new Uint32Array(storage?.data ?? new ArrayBuffer(0));
      expect(flags[22]).toBe(0);
      expect(flags[46]).toBe(INSTANCE_EMPHASIS_FLAG);
      const afterAdmission = gpu.writes.length;
      syncInstanceEmphasisAdmission(draw, emphasized, new Set([part.id]));
      expect(gpu.writes.length).toBe(afterAdmission);
      syncInstanceEmphasisAdmission(draw, new Map(), new Set([part.id]));
      expect(new Uint32Array(storage?.data ?? new ArrayBuffer(0))[46]).toBe(0);
    } finally {
      restore();
    }
  });

  it("preserves admission when an instance style record is patched", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      const update = {
        slot: 0,
        elementPickId: 1,
        facePickId: 0,
        nodePickId: 0,
        style: defaultStyle,
      };
      syncInstanceEmphasisAdmission(draw, new Map([[part.id, [update]]]), new Set([part.id]));
      patchInstances(draw, part.id, [
        {
          slot: 0,
          data: encodeInstanceRecord(translationMatrix(2, 0, 0), defaultStyle, 1, true),
        },
      ]);
      const flags = new Uint32Array(draw.storages.get(part.id)?.data ?? new ArrayBuffer(0));
      expect(flags[22]).toBe(INSTANCE_SELECTED_FLAG | INSTANCE_EMPHASIS_FLAG);
    } finally {
      restore();
    }
  });

  it("admits dense selected occurrences without sparse emphasis records", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      const denseSelections: DenseElementSelections = new Map([
        [
          part.id,
          {
            elementCount: 2,
            occurrences: [{ slot: 0, selectedCount: 1, words: new Uint32Array([1]) }],
          },
        ],
      ]);
      syncInstanceEmphasisAdmission(draw, new Map(), new Set([part.id]), {
        elements: denseSelections,
      });
      const flags = new Uint32Array(draw.storages.get(part.id)?.data ?? new ArrayBuffer(0));
      expect(flags[22]).toBe(INSTANCE_EMPHASIS_FLAG);
    } finally {
      restore();
    }
  });

  it("looks up only affected part storages", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      Object.defineProperty(draw.storages, Symbol.iterator, {
        value: () => {
          throw new Error("all storages were scanned");
        },
      });
      syncInstanceEmphasisAdmission(draw, new Map(), new Set([part.id]));
    } finally {
      restore();
    }
  });

  it("addresses patched slots at their record offsets", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 2, data: record(1) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 2, data: record(9) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[2 * 96, 96]]);
    } finally {
      restore();
    }
  });

  it("writes the complete record when only emissive changes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const styled = (emissive: number) =>
        encodeInstanceRecord(
          translationMatrix(1, 0, 0),
          {
            color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
            emissive,
            opacity: 1,
            lineWidthPixels: 2,
            edge: false,
            nodes: false,
          },
          1,
        );
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0.5) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[0, 96]]);
    } finally {
      restore();
    }
  });

  it("coalesces adjacent changed slots into one contiguous write", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [
        { slot: 0, data: denseRecord(1) },
        { slot: 1, data: denseRecord(1) },
      ]);
      patchInstances(draw, part.id, [{ slot: 0, data: denseRecord(2) }]);
      const writes = instanceWrites(gpu);
      expect(writes[0]?.offset).toBe(0);
      expect(writes[0]?.bytes.byteLength).toBe(192);
      expect(writes[1]?.offset).toBe(0);
      expect(writes[1]?.bytes.byteLength).toBe(96);
    } finally {
      restore();
    }
  });

  it("keeps distant changed slots in separate bounded writes", () => {
    const restore = installGpuGlobals();
    try {
      const coalescedGpu = fakeGpuDevice();
      const coalescedDraw = createDrawResources(coalescedGpu.device);
      patchInstances(coalescedDraw, part.id, [
        { slot: 0, data: denseRecord(1) },
        { slot: 3, data: denseRecord(1) },
      ]);
      expect(
        instanceWrites(coalescedGpu).map((write) => [write.offset, write.bytes.byteLength]),
      ).toEqual([[0, 4 * 96]]);

      const sparseGpu = fakeGpuDevice();
      const sparseDraw = createDrawResources(sparseGpu.device);
      patchInstances(sparseDraw, part.id, [
        { slot: 0, data: denseRecord(1) },
        { slot: 4, data: denseRecord(1) },
      ]);
      expect(sparseGpu.writes.map((write) => [write.offset, write.bytes.byteLength])).toEqual([
        [0, 96],
        [4 * 96, 96],
      ]);
    } finally {
      restore();
    }
  });

  it("grows the per-part buffers to cover patched slots", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 5, data: record(1) }]);
      expect(gpu.buffers).toHaveLength(6);
      expect(gpu.buffers[4]?.size).toBe(6 * 96);
      expect(gpu.buffers[5]?.size).toBe(6 * 4);
      patchInstances(draw, part.id, [{ slot: 10, data: record(2) }]);
      expect(gpu.buffers).toHaveLength(8);
      expect(gpu.buffers[6]?.size).toBe(12 * 96);
      expect(gpu.buffers[7]?.size).toBe(12 * 4);
    } finally {
      restore();
    }
  });
});
