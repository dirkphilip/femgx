import { describe, expect, it } from "vitest";
import type { Part } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import {
  beginColorPass,
  createDrawResources,
  drawBatches,
  uploadPart,
  uploadInstances,
  type DrawCallContext,
} from "../../src/renderer/gpu-draw";
import { createDefaultInteraction } from "../../src/renderer/gpu-support";
import type { Instance } from "../../src/scene/types";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const part: Part = {
  id: 1,
  geometry: {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  },
  bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 },
};

const instance: Instance = {
  index: 0,
  instanceId: "1/0",
  partId: 1,
  worldTransform: translation(1, 2, 3),
};

describe("GPU draw path", () => {
  it("uploads part geometry once and caches it", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const first = uploadPart(draw, part);
      const second = uploadPart(draw, part);
      expect(second).toBe(first);
      expect(second.indexCount).toBe(3);
      expect(gpu.buffers).toHaveLength(2);
      expect(gpu.buffers[0]?.size).toBe(36);
      expect(gpu.buffers[1]?.size).toBe(12);
    } finally {
      restore();
    }
  });

  it("encodes instance records and grows the per-part buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const interaction = createDefaultInteraction();
      const first = uploadInstances(draw, part.id, [instance], interaction);
      expect(gpu.buffers).toHaveLength(1);
      expect(gpu.buffers[0]?.size).toBe(96);
      expect(gpu.writes).toHaveLength(1);
      const record = gpu.writes[0];
      if (record === undefined) throw new Error("expected the initial instance upload");
      expect(record.offset).toBe(0);
      expect(record.bytes.byteLength).toBe(96);
      const floats = new Float32Array(record.bytes.buffer);
      expect(floats[12]).toBe(1);
      expect(floats[13]).toBe(2);
      expect(floats[14]).toBe(3);
      expect(floats[16]).toBeCloseTo(0.23);
      expect(floats[19]).toBe(1);
      const ids = new Uint32Array(record.bytes.buffer);
      expect(ids[20]).toBe(1);
      const second = uploadInstances(
        draw,
        part.id,
        [instance, { ...instance, index: 1, instanceId: "1/1" }],
        interaction,
      );
      expect(second).not.toBe(first);
      expect(gpu.buffers[1]?.size).toBe(192);
    } finally {
      restore();
    }
  });

  it("draws one instanced batch per part on a color pass", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const context: DrawCallContext = {
        cameraBindGroup: {} as GPUBindGroup,
        instanceLayout: {} as GPUBindGroupLayout,
        parts: new Map([[part.id, part]]),
        interaction: createDefaultInteraction(),
      };
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(encoder, {} as GPUTextureView, {} as GPUTextureView);
      drawBatches(
        pass,
        draw,
        context,
        [{ partId: part.id, instances: [instance, { ...instance, index: 1, instanceId: "1/1" }] }],
        {} as GPURenderPipeline,
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([{ indexCount: 3, instanceCount: 2 }]);
    } finally {
      restore();
    }
  });
});
