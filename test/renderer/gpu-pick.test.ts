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
  WebGpuPickReadbackError,
} from "../../src/renderer/gpu-pick";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const READBACK_SIZE = READBACK_BYTE_STRIDE * 5;

function readbackBytes(instancePickId = 1, ndcDepth = 1): ArrayBuffer {
  const bytes = new Uint8Array(READBACK_SIZE);
  new DataView(bytes.buffer).setUint32(0, instancePickId, true);
  new DataView(bytes.buffer).setFloat32(READBACK_BYTE_STRIDE * 4, ndcDepth, true);
  return bytes.buffer;
}

describe("GPU pick targets", () => {
  it("maps and clamps pick pixels to the canvas bounds", () => {
    const rect = { width: 100, height: 100 };
    expect(pickPixelCoordinates(50, 50, rect, 800, 600)).toEqual({ x: 400, y: 300 });
    expect(pickPixelCoordinates(-10, -10, rect, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(pickPixelCoordinates(10_000, 10_000, rect, 800, 600)).toEqual({ x: 799, y: 599 });
  });

  it("maps CSS tap coordinates to device pixels on a high-DPI canvas", () => {
    // A 390x844 CSS phone canvas at devicePixelRatio 2 has a 780x1688 backing
    // store; a CSS tap must read the matching device pixel.
    const rect = { width: 390, height: 844 };
    expect(pickPixelCoordinates(195, 422, rect, 780, 1688)).toEqual({ x: 390, y: 844 });
    expect(pickPixelCoordinates(0, 0, rect, 780, 1688)).toEqual({ x: 0, y: 0 });
    expect(pickPixelCoordinates(390, 844, rect, 780, 1688)).toEqual({ x: 779, y: 1687 });
  });

  it("creates the pick targets once and clears them on destroy", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const pick = createPickTargets();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      expect(gpu.textureCreations).toBe(6);
      expect(pick.texture).toBeDefined();
      expect(pick.elementTexture).toBeDefined();
      expect(pick.faceTexture).toBeDefined();
      expect(pick.nodeTexture).toBeDefined();
      expect(pick.displayedDepthTexture).toBeDefined();
      expect(pick.depthTexture).toBeDefined();
      destroyPickTargets(pick);
      expect(pick.texture).toBeUndefined();
      expect(pick.elementTexture).toBeUndefined();
      expect(pick.faceTexture).toBeUndefined();
      expect(pick.nodeTexture).toBeUndefined();
      expect(pick.displayedDepthTexture).toBeUndefined();
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
        ndcDepth: 1,
      });
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toEqual({
        instancePickId: 7,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
        ndcDepth: 1,
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
        ndcDepth: 0.375,
      });
      const pick = createPickTargets();
      const canvas = fakeCanvas();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toEqual({
        instancePickId: 3,
        elementPickId: 9,
        facePickId: 12,
        nodePickId: 20,
        ndcDepth: 0.375,
      });
    } finally {
      restore();
    }
  });

  it("throws a typed pick-readback error when the readback map fails", async () => {
    const restore = installGpuGlobals();
    try {
      const device = {
        queue: { submit: () => undefined },
        createBuffer: () => ({
          mapAsync: () => Promise.reject(new Error("mapAsync rejected")),
          getMappedRange: () => new Uint8Array(0),
          unmap: () => undefined,
          destroy: () => undefined,
        }),
        createCommandEncoder: () => ({
          copyTextureToBuffer: () => undefined,
          finish: () => ({}),
        }),
        createTexture: () => ({ createView: () => ({}), destroy: () => undefined }),
      } as unknown as GPUDevice;
      const pick = createPickTargets();
      ensurePickTargets(device, pick, 800, 600, "depth24plus");
      const canvas = fakeCanvas();
      await expect(readPickPixel(device, canvas, pick, 10, 10)).rejects.toBeInstanceOf(
        WebGpuPickReadbackError,
      );
    } finally {
      restore();
    }
  });

  it("reads the device-pixel coordinate matching a CSS tap on a high-DPI canvas", async () => {
    const restore = installGpuGlobals();
    try {
      const copiedOrigins: Array<{ readonly x: number; readonly y: number }> = [];
      const device = {
        queue: { submit: () => undefined },
        createBuffer: () => ({
          mapAsync: () => Promise.resolve(),
          getMappedRange: () => readbackBytes(7),
          unmap: () => undefined,
          destroy: () => undefined,
        }),
        createCommandEncoder: () => ({
          copyTextureToBuffer: (
            source: { readonly origin: { readonly x: number; readonly y: number } },
            _destination: unknown,
            _copy: unknown,
          ) => {
            copiedOrigins.push({ x: source.origin.x, y: source.origin.y });
          },
          finish: () => ({}),
        }),
        createTexture: () => ({ createView: () => ({}), destroy: () => undefined }),
      } as unknown as GPUDevice;
      const pick = createPickTargets();
      ensurePickTargets(device, pick, 780, 1688, "depth24plus");
      // A 390x844 CSS canvas with a 780x1688 device backing store: a tap at
      // CSS (195, 422) must copy from the device pixel (390, 844).
      const canvas = {
        width: 780,
        height: 1688,
        getBoundingClientRect: () => ({ width: 390, height: 844 }),
      } as unknown as HTMLCanvasElement;
      await readPickPixel(device, canvas, pick, 195, 422);
      expect(copiedOrigins[0]).toEqual({ x: 390, y: 844 });
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
            getMappedRange: () => readbackBytes(),
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
        ndcDepth: 1,
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
        ndcDepth: 1,
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
            getMappedRange: () => readbackBytes(),
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
      pick.displayedDepthTexture = {} as GPUTexture;
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
        ndcDepth: 1,
      });
      await expect(second).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
        ndcDepth: 1,
      });
      const third = readPickPixel(device, canvas, pick, 3, 3);
      expect(bufferCount).toBe(2);
      deferred[2]?.();
      await expect(third).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
        ndcDepth: 1,
      });
    } finally {
      restore();
    }
  });
});
