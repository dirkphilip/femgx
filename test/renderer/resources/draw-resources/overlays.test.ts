import { expect, it, describe } from "vitest";
import {
  createDrawResources,
  patchInstances,
  uploadPart,
  writeDrawOrder,
  writeEdgeOrder,
  writeNodeOrder,
  drawBatches,
  beginColorPass,
  fakeGpuDevice,
  installGpuGlobals,
  part,
  nodePart,
  record,
  writeRanges,
  drawContext,
} from "./support";

describe("GPU draw path", () => {
  it("writes the node annotation order to its own buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      writeNodeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const afterInitial = gpu.writes.length;
      writeNodeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      expect(gpu.writes.length).toBe(afterInitial);
      writeNodeOrder(draw, part.id, new Uint32Array([0, 2]));
      expect(writeRanges(gpu, afterInitial)).toEqual([[4, 8]]);
    } finally {
      restore();
    }
  });

  it("draws the overlay pass through the edge order and edge index buffers", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const resource = uploadPart(draw, part);
      expect(resource.edge).toBeUndefined();
      expect(gpu.buffers).toHaveLength(9);
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
        { slot: 2, data: record(2) },
      ]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 2]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 3 }], {
        kind: "surface",
        pass: "color",
      });
      const buffersBeforeEdge = gpu.buffers.length;
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 2 }], {
        kind: "edge",
        pipeline: {} as GPURenderPipeline,
      });
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 3 },
        { indexCount: 6, instanceCount: 2 },
      ]);
      expect(gpu.bindGroupCreations).toBe(2);
      expect(resource.edge).toBeDefined();
      expect(gpu.buffers).toHaveLength(buffersBeforeEdge + 4);
      const buffersAfterFirstEdge = gpu.buffers.length;
      const encoder2 = gpu.device.createCommandEncoder();
      const pass2 = beginColorPass(
        encoder2,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass2, draw, drawContext(), [{ partId: part.id, instanceCount: 2 }], {
        kind: "edge",
        pipeline: {} as GPURenderPipeline,
      });
      pass2.end();
      expect(gpu.buffers).toHaveLength(buffersAfterFirstEdge);
    } finally {
      restore();
    }
  });

  it("draws node annotations through the node order buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, nodePart.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
      ]);
      writeNodeOrder(draw, nodePart.id, new Uint32Array([0, 1]));
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
        { ...drawContext(), parts: new Map([[nodePart.id, nodePart]]) },
        [{ partId: nodePart.id, instanceCount: 2 }],
        { kind: "nodes", pipeline: {} as GPURenderPipeline },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[nodePart.id, nodePart]]) },
        [{ partId: nodePart.id, instanceCount: 2 }],
        { kind: "nodes", pipeline: {} as GPURenderPipeline },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 18, instanceCount: 2 },
        { indexCount: 18, instanceCount: 2 },
      ]);
      expect(gpu.bindGroupCreations).toBe(1);
    } finally {
      restore();
    }
  });

  it("binds node annotations to their own node-id table after an elemental-result surface draw", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, nodePart.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, nodePart.id, new Uint32Array([0]));
      writeNodeOrder(draw, nodePart.id, new Uint32Array([0]));
      const context = { ...drawContext(), parts: new Map([[nodePart.id, nodePart]]) };
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, context, [{ partId: nodePart.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "color",
      });
      drawBatches(pass, draw, context, [{ partId: nodePart.id, instanceCount: 1 }], {
        kind: "nodes",
        pipeline: {} as GPURenderPipeline,
      });
      pass.end();
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });
});
