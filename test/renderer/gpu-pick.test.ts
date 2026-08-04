import { describe, expect, it } from "vitest";
import {
  beginPickPass,
  createPickTargets,
  destroyPickTargets,
  ensurePickTargets,
  pickPixelCoordinates,
  READBACK_BYTE_STRIDE,
  readPickPixel,
  resetPickTargets,
} from "../../src/renderer/gpu-pick";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const READBACK_SIZE = READBACK_BYTE_STRIDE * 4;

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
      expect(gpu.textureCreations).toBe(5);
      expect(pick.texture).toBeDefined();
      expect(pick.elementTexture).toBeDefined();
      expect(pick.faceTexture).toBeDefined();
      expect(pick.nodeTexture).toBeDefined();
      expect(pick.depthTexture).toBeDefined();
      destroyPickTargets(pick);
      expect(pick.texture).toBeUndefined();
      expect(pick.elementTexture).toBeUndefined();
      expect(pick.faceTexture).toBeUndefined();
      expect(pick.nodeTexture).toBeUndefined();
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
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toEqual({
        instancePickId: 0,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
      });
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toEqual({
        instancePickId: 7,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
      });
    } finally {
      restore();
    }
  });

  it("decodes the element, face, and node pick ids from the later attachments", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({
        pickValue: 3,
        elementPickValue: 9,
        facePickValue: 12,
        nodePickValue: 20,
      });
      const pick = createPickTargets();
      const canvas = fakeCanvas();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toEqual({
        instancePickId: 3,
        elementPickId: 9,
        facePickId: 12,
        nodePickId: 20,
      });
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
      const readbackBuffers = gpu.buffers.filter((buffer) => buffer.size === READBACK_SIZE);
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
      const readbackBuffers = gpu.buffers.filter((buffer) => buffer.size === READBACK_SIZE);
      expect(readbackBuffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      restore();
    }
  });

  it("keeps the readback pool while resetting the render targets on resize", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 5 });
      const pick = createPickTargets();
      const canvas = fakeCanvas();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await readPickPixel(gpu.device, canvas, pick, 10, 10);
      resetPickTargets(pick);
      expect(pick.texture).toBeUndefined();
      expect(pick.elementTexture).toBeUndefined();
      expect(pick.depthTexture).toBeUndefined();
      expect(gpu.textures[0]?.destroyed).toBe(true);
      expect(gpu.textures[1]?.destroyed).toBe(true);
      expect(gpu.textures[2]?.destroyed).toBe(true);
      ensurePickTargets(gpu.device, pick, 400, 300, "depth24plus");
      await readPickPixel(gpu.device, canvas, pick, 20, 20);
      const readbackBuffers = gpu.buffers.filter((buffer) => buffer.size === READBACK_SIZE);
      expect(readbackBuffers).toHaveLength(1);
      expect(readbackBuffers[0]?.destroyed).toBe(false);
    } finally {
      restore();
    }
  });

  it("does not disturb a readback buffer in flight while the targets reset", async () => {
    const restore = installGpuGlobals();
    try {
      const deferred: Array<() => void> = [];
      let bufferCount = 0;
      const device = {
        queue: { submit: () => undefined },
        createBuffer: () => {
          bufferCount += 1;
          const buffer = {
            mapAsync: () =>
              new Promise<void>((resolve) => {
                deferred.push(resolve);
              }),
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
        createTexture: () => ({ createView: () => ({}), destroy: () => undefined }),
      } as unknown as GPUDevice;
      const pick = createPickTargets();
      ensurePickTargets(device, pick, 800, 600, "depth24plus");
      const canvas = fakeCanvas();
      const pending = readPickPixel(device, canvas, pick, 1, 1);
      resetPickTargets(pick);
      deferred[0]?.();
      await expect(pending).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
      });
      ensurePickTargets(device, pick, 800, 600, "depth24plus");
      const after = readPickPixel(device, canvas, pick, 2, 2);
      expect(bufferCount).toBe(1);
      deferred[1]?.();
      await expect(after).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
      });
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
      pick.elementTexture = {} as GPUTexture;
      pick.faceTexture = {} as GPUTexture;
      pick.nodeTexture = {} as GPUTexture;
      const canvas = fakeCanvas();
      const first = readPickPixel(device, canvas, pick, 1, 1);
      const second = readPickPixel(device, canvas, pick, 2, 2);
      expect(bufferCount).toBe(2);
      deferred[0]?.();
      deferred[1]?.();
      await expect(first).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
      });
      await expect(second).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
      });
      const third = readPickPixel(device, canvas, pick, 3, 3);
      expect(bufferCount).toBe(2);
      deferred[2]?.();
      await expect(third).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
      });
    } finally {
      restore();
    }
  });
});
