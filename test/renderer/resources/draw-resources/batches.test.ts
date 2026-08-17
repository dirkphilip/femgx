import { expect, it, describe } from "vitest";
import {
  createPart,
  createDrawResources,
  patchInstances,
  writeDrawOrder,
  writeEdgeOrder,
  drawBatches,
  beginColorPass,
  fakeGpuDevice,
  installGpuGlobals,
  part,
  record,
  drawContext,
  type DrawCallContext,
  type DrawPipelines,
} from "./support";

describe("GPU draw path", () => {
  it("skips overlay batches that have no edge geometry", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const linePart = createPart(4, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
            indices: new Uint32Array([0, 1]),
            primitive: "lines",
          },
        ],
      });
      patchInstances(draw, linePart.id, [{ slot: 0, data: record(0) }]);
      writeEdgeOrder(draw, linePart.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      const context = { ...drawContext(), parts: new Map([[linePart.id, linePart]]) };
      drawBatches(pass, draw, context, [{ partId: linePart.id, instanceCount: 1 }], {
        kind: "edge",
        pipeline: {} as GPURenderPipeline,
      });
      pass.end();
      expect(gpu.drawCalls).toEqual([]);
      expect(gpu.bindGroupCreations).toBe(0);
    } finally {
      restore();
    }
  });

  it("draws one instanced batch per part from its storage buffers", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
      ]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 2 }], {
        kind: "surface",
        pass: "color",
      });
      pass.end();
      expect(gpu.drawCalls).toEqual([{ indexCount: 3, instanceCount: 2 }]);
    } finally {
      restore();
    }
  });

  it("switches pipelines to match each part's primitive topology", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const trianglePart = part;
      const linePart = createPart(2, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
            indices: new Uint32Array([0, 1]),
            primitive: "lines",
          },
        ],
      });
      const pointPart = createPart(3, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
            indices: new Uint32Array([0, 1]),
            primitive: "points",
          },
        ],
      });
      const pipelines = {
        trianglesColor: { name: "triangles-color" },
        linesColor: { name: "lines-color" },
        pointsColor: { name: "points-color" },
      } as unknown as DrawPipelines;
      for (const item of [trianglePart, linePart, pointPart]) {
        patchInstances(draw, item.id, [{ slot: 0, data: record(0) }]);
        writeDrawOrder(draw, item.id, new Uint32Array([0]));
      }
      const context: DrawCallContext = {
        frameBindGroup: {} as GPUBindGroup,
        instanceLayout: {} as GPUBindGroupLayout,
        parts: new Map([
          [trianglePart.id, trianglePart],
          [linePart.id, linePart],
          [pointPart.id, pointPart],
        ]),
        pipelines,
        resultColors: undefined,
        usesExteriorFaceSubsets: true,
      };
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
        context,
        [
          { partId: trianglePart.id, instanceCount: 1 },
          { partId: linePart.id, instanceCount: 1 },
          { partId: pointPart.id, instanceCount: 1 },
        ],
        { kind: "surface", pass: "color" },
      );
      pass.end();
      expect(gpu.pipelineCalls).toEqual([
        pipelines.trianglesColor,
        pipelines.linesColor,
        pipelines.pointsColor,
      ]);
      expect(gpu.drawCalls).toHaveLength(3);
      expect(draw.cost.snapshot().admissions).toEqual({ minimal: 0, topology: 2, feature: 1 });
    } finally {
      restore();
    }
  });

  it("reuses one bind group per storage across frames", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const calls = [{ partId: part.id, instanceCount: 1 }];
      for (let frame = 0; frame < 3; frame += 1) {
        const encoder = gpu.device.createCommandEncoder();
        const pass = beginColorPass(
          encoder,
          {} as GPUTextureView,
          {} as GPUTextureView,
          {} as GPUTextureView,
        );
        drawBatches(pass, draw, drawContext(), calls, { kind: "surface", pass: "color" });
        pass.end();
      }
      expect(gpu.bindGroupCreations).toBe(1);
      expect(gpu.drawCalls).toHaveLength(3);
    } finally {
      restore();
    }
  });
});
