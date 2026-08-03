import { describe, expect, it } from "vitest";
import {
  beginPickPass,
  createPickTargets,
  destroyPickTargets,
  ensurePickTargets,
  pickPixelCoordinates,
  readPickPixel,
} from "../../src/renderer/gpu-pick";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("GPU pick targets", () => {
  it("maps and clamps pick pixels to the canvas bounds", () => {
    const rect = { width: 100, height: 100 };
    expect(pickPixelCoordinates(50, 50, rect, 800, 600)).toEqual({ x: 400, y: 300 });
    expect(pickPixelCoordinates(-10, -10, rect, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(pickPixelCoordinates(10_000, 10_000, rect, 800, 600)).toEqual({ x: 799, y: 599 });
  });

  it("creates the pick targets once and clears them on destroy", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const pick = createPickTargets();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      expect(gpu.textureCreations).toBe(2);
      expect(pick.texture).toBeDefined();
      expect(pick.depthTexture).toBeDefined();
      destroyPickTargets(pick);
      expect(pick.texture).toBeUndefined();
      expect(pick.depthTexture).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("rejects a pick pass before the targets are created", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const encoder = gpu.device.createCommandEncoder();
      expect(() => beginPickPass(encoder, createPickTargets())).toThrow(
        "WebGPU picking targets were not created",
      );
    } finally {
      restore();
    }
  });

  it("reads the pick id under the pointer, returning 0 before targets exist", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 7 });
      const pick = createPickTargets();
      const canvas = fakeCanvas();
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toBe(0);
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toBe(7);
    } finally {
      restore();
    }
  });

  it("pools the readback buffer across sequential pick calls", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 7 });
      const pick = createPickTargets();
      const canvas = fakeCanvas();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await readPickPixel(gpu.device, canvas, pick, 10, 10);
      await readPickPixel(gpu.device, canvas, pick, 20, 20);
      await readPickPixel(gpu.device, canvas, pick, 30, 30);
      const readbackBuffers = gpu.buffers.filter((buffer) => buffer.size === 256);
      expect(readbackBuffers).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("destroys pooled readback buffers on destroy", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 7 });
      const pick = createPickTargets();
      const canvas = fakeCanvas();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await readPickPixel(gpu.device, canvas, pick, 10, 10);
      await readPickPixel(gpu.device, canvas, pick, 20, 20);
      destroyPickTargets(pick);
      const readbackBuffers = gpu.buffers.filter((buffer) => buffer.size === 256);
      expect(readbackBuffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      restore();
    }
  });

  it("hands out distinct buffers while a map is in flight and reuses them after", async () => {
    const restore = installGpuGlobals();
    try {
      const deferred: Array<() => void> = [];
      const mapped = new Set<GPUBuffer>();
      let bufferCount = 0;
      const device = {
        queue: { submit: () => undefined },
        createBuffer: () => {
          bufferCount += 1;
          const buffer = {
            mapAsync: () => {
              expect(mapped.has(buffer)).toBe(false);
              mapped.add(buffer);
              return new Promise<void>((resolve) => {
                deferred.push(() => {
                  mapped.delete(buffer);
                  resolve();
                });
              });
            },
            getMappedRange: () => new Uint32Array([1]).buffer,
            unmap: () => undefined,
            destroy: () => undefined,
          } as unknown as GPUBuffer;
          return buffer;
        },
        createCommandEncoder: () => ({
          copyTextureToBuffer: () => undefined,
          finish: () => ({}),
        }),
      } as unknown as GPUDevice;
      const pick = createPickTargets();
      pick.texture = {} as GPUTexture;
      const canvas = fakeCanvas();
      const first = readPickPixel(device, canvas, pick, 1, 1);
      const second = readPickPixel(device, canvas, pick, 2, 2);
      expect(bufferCount).toBe(2);
      deferred[0]?.();
      deferred[1]?.();
      await expect(first).resolves.toBe(1);
      await expect(second).resolves.toBe(1);
      const third = readPickPixel(device, canvas, pick, 3, 3);
      expect(bufferCount).toBe(2);
      deferred[2]?.();
      await expect(third).resolves.toBe(1);
    } finally {
      restore();
    }
  });
});
