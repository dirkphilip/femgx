import { describe, expect, it } from "vitest";
import type { Part } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import {
  beginColorPass,
  createDrawResources,
  destroyDrawResources,
  drawBatches,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  ensureDepthTexture,
  patchInstances,
  uploadPart,
  writeDrawOrder,
  type DrawCallContext,
} from "../../src/renderer/gpu-draw";
import { defaultStyle } from "../../src/renderer/gpu-support";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  MAX_ELEMENT_HIGHLIGHTS,
} from "../../src/renderer/gpu-elements";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const HIGHLIGHT_BUFFER_SIZE = HIGHLIGHT_HEADER + MAX_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE;

const part: Part = {
  id: 1,
  geometry: {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  },
  bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 },
};

function record(x: number): ArrayBuffer {
  return encodeInstanceRecord(translation(x, 0, 0), defaultStyle, 1);
}

/** A record whose bytes are all non-zero so every byte diffs against zeros. */
function denseRecord(fill: number): ArrayBuffer {
  const data = new Uint8Array(96);
  data.fill(fill);
  return data.buffer;
}

function instanceWrites(gpu: ReturnType<typeof fakeGpuDevice>) {
  return gpu.writes.filter((write) => write.bytes.byteLength !== 64);
}

function writeRanges(gpu: ReturnType<typeof fakeGpuDevice>, start: number) {
  return instanceWrites(gpu)
    .slice(start)
    .map((write) => [write.offset, write.bytes.byteLength] as const);
}

function drawContext(): DrawCallContext {
  return {
    cameraBindGroup: {} as GPUBindGroup,
    instanceLayout: {} as GPUBindGroupLayout,
    parts: new Map([[part.id, part]]),
  };
}

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
      expect(gpu.buffers).toHaveLength(3);
      expect(gpu.buffers[0]?.size).toBe(36);
      expect(gpu.buffers[1]?.size).toBe(12);
      expect(gpu.buffers[2]?.size).toBe(4);
    } finally {
      restore();
    }
  });

  it("encodes transform, style, emissive, and stable pick id into a record", () => {
    const data = encodeInstanceRecord(
      translation(1, 2, 3),
      { color: { r: 1, g: 0.5, b: 0.25, a: 1 }, emissive: 0.4, opacity: 0.5 },
      7,
    );
    const floats = new Float32Array(data);
    const ids = new Uint32Array(data);
    expect(floats[12]).toBe(1);
    expect(floats[13]).toBe(2);
    expect(floats[14]).toBe(3);
    expect(floats[16]).toBe(1);
    expect(floats[19]).toBeCloseTo(0.5);
    expect(ids[20]).toBe(7);
    expect(new Float32Array(data, EMISSIVE_BYTE_OFFSET, 1)[0]).toBeCloseTo(0.4);
  });

  it("writes only the changed subranges of patched slots", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      expect(gpu.writes.length).toBe(afterInitial);
      patchInstances(draw, part.id, [{ slot: 0, data: record(9) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[48, 4]]);
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
      expect(writeRanges(gpu, afterInitial)).toEqual([[2 * 96 + 48, 4]]);
    } finally {
      restore();
    }
  });

  it("patches only the emissive float when only emissive changes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const styled = (emissive: number) =>
        encodeInstanceRecord(
          translation(1, 0, 0),
          { color: { r: 0.23, g: 0.51, b: 0.96, a: 1 }, emissive, opacity: 1 },
          1,
        );
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0.5) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[EMISSIVE_BYTE_OFFSET, 4]]);
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

  it("grows the per-part buffers to cover patched slots", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 5, data: record(1) }]);
      expect(gpu.buffers).toHaveLength(3);
      expect(gpu.buffers[0]?.size).toBe(6 * 96);
      expect(gpu.buffers[1]?.size).toBe(6 * 4);
      expect(gpu.buffers[2]?.size).toBe(HIGHLIGHT_BUFFER_SIZE);
      patchInstances(draw, part.id, [{ slot: 10, data: record(2) }]);
      expect(gpu.buffers[3]?.size).toBe(12 * 96);
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
      const pass = beginColorPass(encoder, {} as GPUTextureView, {} as GPUTextureView);
      drawBatches(
        pass,
        draw,
        drawContext(),
        [{ partId: part.id, instanceCount: 2 }],
        {} as GPURenderPipeline,
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([{ indexCount: 3, instanceCount: 2 }]);
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
        const pass = beginColorPass(encoder, {} as GPUTextureView, {} as GPUTextureView);
        drawBatches(pass, draw, drawContext(), calls, {} as GPURenderPipeline);
        pass.end();
      }
      expect(gpu.bindGroupCreations).toBe(1);
      expect(gpu.drawCalls).toHaveLength(3);
    } finally {
      restore();
    }
  });

  it("creates a new bind group when the storage grows", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(encoder, {} as GPUTextureView, {} as GPUTextureView);
      drawBatches(
        pass,
        draw,
        drawContext(),
        [{ partId: part.id, instanceCount: 1 }],
        {} as GPURenderPipeline,
      );
      pass.end();
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
        { slot: 2, data: record(2) },
      ]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const encoder2 = gpu.device.createCommandEncoder();
      const pass2 = beginColorPass(encoder2, {} as GPUTextureView, {} as GPUTextureView);
      drawBatches(
        pass2,
        draw,
        drawContext(),
        [{ partId: part.id, instanceCount: 3 }],
        {} as GPURenderPipeline,
      );
      pass2.end();
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });

  it("reuses the depth texture and only resizes when the canvas size changes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const first = ensureDepthTexture(draw, 800, 600, "depth24plus");
      const second = ensureDepthTexture(draw, 800, 600, "depth24plus");
      expect(second).toBe(first);
      expect(gpu.textureCreations).toBe(1);
      const resized = ensureDepthTexture(draw, 400, 300, "depth24plus");
      expect(resized).not.toBe(first);
      expect(gpu.textureCreations).toBe(2);
      expect(gpu.textures[0]?.destroyed).toBe(true);
      destroyDrawResources(draw);
      expect(gpu.textures[1]?.destroyed).toBe(true);
    } finally {
      restore();
    }
  });
});
