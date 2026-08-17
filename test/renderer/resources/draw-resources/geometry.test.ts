import { expect, it, describe } from "vitest";
import {
  createDrawResources,
  patchInstances,
  uploadPart,
  ensureEdgePickResources,
  writeDrawOrder,
  drawBatches,
  beginColorPass,
  fakeGpuDevice,
  installGpuGlobals,
  part,
  authoredEdgePart,
  subsetPart,
  mixedPart,
  record,
  drawContext,
  type DrawCallContext,
  type DrawPipelines,
} from "./support";

describe("GPU draw path", () => {
  it("admits plain triangle surfaces minimally and promotes feature state", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const pipelines = {
        minimalTrianglesColor: { name: "minimal-triangles-color" },
        minimalTrianglesTransparent: { name: "minimal-triangles-transparent" },
        trianglesColor: { name: "triangles-color" },
        trianglesTransparent: { name: "triangles-transparent" },
      } as unknown as DrawPipelines;
      const context: DrawCallContext = {
        ...drawContext(),
        frameBindGroup: { name: "feature-frame" } as unknown as GPUBindGroup,
        minimalFrameBindGroup: { name: "minimal-frame" } as unknown as GPUBindGroup,
        minimalInstanceLayout: { name: "minimal-instance" } as unknown as GPUBindGroupLayout,
        pipelines,
      };
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, context, [{ partId: part.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "color",
      });
      drawBatches(pass, draw, context, [{ partId: part.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "transparent",
      });
      drawBatches(
        pass,
        draw,
        { ...context, resultColors: new Map([[part.id, new Float32Array([1, 0, 0, 1])]]) },
        [{ partId: part.id, instanceCount: 1 }],
        { kind: "surface", pass: "color" },
      );
      pass.end();
      expect(gpu.pipelineCalls).toEqual([
        pipelines.minimalTrianglesColor,
        pipelines.minimalTrianglesTransparent,
        pipelines.trianglesColor,
      ]);
      expect(draw.cost.snapshot().admissions).toEqual({ minimal: 2, topology: 0, feature: 1 });
      expect(draw.admissionCache.get(part.id)?.admission).toBe("feature");
    } finally {
      restore();
    }
  });

  it("draws every primitive leaf from one semantic part", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, mixedPart.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, mixedPart.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[mixedPart.id, mixedPart]]) },
        [{ partId: mixedPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "color" },
      );
      pass.end();
      expect(gpu.drawCalls.map((call) => call.indexCount)).toEqual([3, 6, 6]);
      expect(draw.primitiveParts.get(mixedPart.id)?.size).toBe(3);
    } finally {
      restore();
    }
  });

  it("uploads part geometry once and caches it", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const first = uploadPart(draw, part);
      const second = uploadPart(draw, part);
      expect(second).toBe(first);
      expect(second.indexCount).toBe(3);
      expect(gpu.buffers).toHaveLength(8);
      expect(gpu.buffers[3]?.size).toBe(68);
      expect(gpu.buffers[4]?.size).toBe(12);
      expect(gpu.buffers[5]?.size).toBe(4);
      expect(gpu.buffers[6]?.size).toBe(12);
      expect(gpu.buffers[7]?.size).toBe(56);
      expect(first.edge).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("keeps authored-edge pick resources lazy and absent for generic parts", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const generic = uploadPart(draw, part);
      expect(generic.edge).toBeUndefined();
      expect(generic.edgePick).toBeUndefined();
      expect(ensureEdgePickResources(draw, part, generic)).toBeUndefined();

      const authored = uploadPart(draw, authoredEdgePart);
      expect(authored.edge).toBeUndefined();
      expect(authored.edgePick).toBeUndefined();
      const edgePick = ensureEdgePickResources(draw, authoredEdgePart, authored);
      expect(edgePick?.edgeKeys).toEqual(["0,1", "0,2", "1,2"]);
      expect(authored.edgePick).toBe(edgePick);
      expect(authored.edge).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("draws and caches opaque and transparent face-subset bindings", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const resource = uploadPart(draw, subsetPart);
      expect(resource.indexCount).toBe(6);
      expect(resource.subsetIndexCount).toBe(3);
      expect(resource.subsetIndexBuffer).toBeDefined();
      expect(resource.edge).toBeUndefined();
      expect(gpu.buffers).toHaveLength(12);

      patchInstances(draw, subsetPart.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, subsetPart.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "color" },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "color" },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "transparent" },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "transparent" },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
      ]);
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });
});
