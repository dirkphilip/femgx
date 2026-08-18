import { expect, it, describe } from "vitest";
import {
  createDrawResources,
  destroyDrawResources,
  uploadPart,
  patchInstances,
  writeDrawOrder,
  writeEdgeOrder,
  writeTransparentOrder,
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  fakeGpuDevice,
  installGpuGlobals,
  createPart,
  part,
  record,
  uploadPart,
  writeRanges,
} from "./support";
import { orderBindGroup } from "../../../../src/renderer/resources/bind-groups";
import { reconcilePartResources } from "../../../../src/renderer/resources/part-resources";

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
          HIGHLIGHT_HEADER + ELEMENT_RECORD_STRIDE + 24 + partCount * (96 + 4),
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
      expect(gpu.buffers).toHaveLength(6);

      writeTransparentOrder(draw, part.id, new Uint32Array([0, 1]));
      const transparent = storage?.sidecars.transparent;
      expect(transparent?.capacity).toBe(2);
      expect(transparent?.buffer.size).toBe(8);
      expect(gpu.buffers).toHaveLength(7);

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
      const resource = uploadPart(draw, part);
      const minimalBuffer = resource.minimalIndexBuffer;
      expect(minimalBuffer).toBe(resource.facePickIdsBuffer);
      destroyDrawResources(draw);
      destroyDrawResources(draw);
      expect(gpu.buffers.every((buffer) => buffer.destroyCount === 1)).toBe(true);
      expect(gpu.buffers.find((buffer) => buffer.resource === minimalBuffer)?.destroyCount).toBe(1);
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

  it("invalidates cached bind groups when a part definition is replaced", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const firstResource = uploadPart(draw, part);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const storage = draw.storages.get(part.id);
      if (storage === undefined) throw new Error("Part storage was not created");
      const inputs = {
        geometry: firstResource,
        deformation: draw.emptyDeformationBuffer,
        resultColors: draw.emptyResultColorBuffer,
        admission: "topology" as const,
      };
      const firstBindGroup = orderBindGroup(
        gpu.device,
        {} as GPUBindGroupLayout,
        storage,
        "opaque",
        inputs,
      );

      const replacement = createPart(1, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
            indices: new Uint32Array([0, 1, 2]),
            primitive: "triangles" as const,
          },
        ],
      });
      reconcilePartResources(
        new Map([[part.id, part]]),
        new Map([[replacement.id, replacement]]),
        draw,
      );

      expect(storage.bindGroup).toBeUndefined();
      const secondResource = uploadPart(draw, replacement);
      const secondBindGroup = orderBindGroup(
        gpu.device,
        {} as GPUBindGroupLayout,
        storage,
        "opaque",
        { ...inputs, geometry: secondResource },
      );
      expect(secondBindGroup).not.toBe(firstBindGroup);
    } finally {
      restore();
    }
  });
});
