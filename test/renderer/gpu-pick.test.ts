import { describe, expect, it, vi } from "vitest";
import {
  createPickTargets,
  destroyPickTargets,
  ensurePickTargets,
  pickPixelCoordinates,
  READBACK_BYTE_STRIDE,
  readPickPixel,
  resetPickTargets,
  WebGpuPickReadbackError,
} from "../../src/renderer/gpu-pick";
import { beginPickPass } from "../../src/renderer/gpu-pick-pass";
import { createPickDepthReadback } from "../../src/renderer/gpu-pick-depth";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const READBACK_SIZE = READBACK_BYTE_STRIDE * 5;

async function createTestPickTargets(device: GPUDevice) {
  return createPickTargets(await createPickDepthReadback(device));
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

  it("creates the pick targets once and clears them on destroy", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const pick = await createTestPickTargets(gpu.device);
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      expect(gpu.textureCreations).toBe(5);
      expect(pick.texture).toBeDefined();
      expect(pick.elementTexture).toBeDefined();
      expect(pick.faceTexture).toBeDefined();
      expect(pick.nodeTexture).toBeDefined();
      expect(pick.depthTexture).toBeDefined();
      expect(pick.depthReadback).toBeDefined();
      expect(gpu.textures.at(-1)?.descriptor.usage).toBe(
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      );
      const depthRequest = gpu.buffers.find((buffer) => buffer.size === 16);
      expect(depthRequest).toBeDefined();
      destroyPickTargets(pick);
      expect(pick.texture).toBeUndefined();
      expect(pick.elementTexture).toBeUndefined();
      expect(pick.faceTexture).toBeUndefined();
      expect(pick.nodeTexture).toBeUndefined();
      expect(pick.depthTexture).toBeUndefined();
      expect(pick.depthReadback).toBeUndefined();
      expect(depthRequest?.destroyed).toBe(true);
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
      const pick = await createTestPickTargets(gpu.device);
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
      const pick = await createTestPickTargets(gpu.device);
      const canvas = fakeCanvas();
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).resolves.toEqual({
        instancePickId: 3,
        elementPickId: 9,
        facePickId: 12,
        nodePickId: 20,
        ndcDepth: 0.375,
      });
      expect(gpu.computeDispatchCount).toBe(1);
      expect(gpu.bufferCopies).toEqual([
        { sourceOffset: 8, destinationOffset: READBACK_BYTE_STRIDE * 4, size: 4 },
      ]);
    } finally {
      restore();
    }
  });

  it("throws a typed pick-readback error when the readback map fails", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({
        mapAsync: () => Promise.reject(new Error("mapAsync rejected")),
      });
      const pick = await createTestPickTargets(gpu.device);
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      const canvas = fakeCanvas();
      await expect(readPickPixel(gpu.device, canvas, pick, 10, 10)).rejects.toBeInstanceOf(
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
      const gpu = fakeGpuDevice({
        pickValue: 7,
        onCopyTextureToBuffer: (source) => {
          const origin = source.origin as { readonly x?: number; readonly y?: number } | undefined;
          copiedOrigins.push({ x: origin?.x ?? 0, y: origin?.y ?? 0 });
        },
      });
      const pick = await createTestPickTargets(gpu.device);
      ensurePickTargets(gpu.device, pick, 780, 1688, "depth24plus");
      // A 390x844 CSS canvas with a 780x1688 device backing store: a tap at
      // CSS (195, 422) must copy from the device pixel (390, 844).
      const canvas = {
        width: 780,
        height: 1688,
        getBoundingClientRect: () => ({ width: 390, height: 844 }),
      } as unknown as HTMLCanvasElement;
      await readPickPixel(gpu.device, canvas, pick, 195, 422);
      expect(copiedOrigins[0]).toEqual({ x: 390, y: 844 });
    } finally {
      restore();
    }
  });

  it("pools the readback buffer across sequential pick calls", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ pickValue: 7 });
      const pick = await createTestPickTargets(gpu.device);
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
      const pick = await createTestPickTargets(gpu.device);
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
      const pick = await createTestPickTargets(gpu.device);
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
      const gpu = fakeGpuDevice({
        pickValue: 1,
        mapAsync: () =>
          new Promise<void>((resolve) => {
            deferred.push(resolve);
          }),
      });
      const pick = await createTestPickTargets(gpu.device);
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      const canvas = fakeCanvas();
      const pending = readPickPixel(gpu.device, canvas, pick, 1, 1);
      resetPickTargets(pick);
      deferred[0]?.();
      await expect(pending).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
        ndcDepth: 1,
      });
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      const after = readPickPixel(gpu.device, canvas, pick, 2, 2);
      expect(gpu.buffers.filter((buffer) => buffer.size === READBACK_SIZE)).toHaveLength(1);
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

  it("serializes depth requests while keeping pooled buffers reusable", async () => {
    const restore = installGpuGlobals();
    try {
      const deferred: Array<() => void> = [];
      const gpu = fakeGpuDevice({
        pickValue: 1,
        mapAsync: () =>
          new Promise<void>((resolve) => {
            deferred.push(resolve);
          }),
      });
      const pick = await createTestPickTargets(gpu.device);
      ensurePickTargets(gpu.device, pick, 800, 600, "depth24plus");
      const canvas = fakeCanvas();
      const first = readPickPixel(gpu.device, canvas, pick, 1, 1);
      const second = readPickPixel(gpu.device, canvas, pick, 2, 2);
      expect(gpu.buffers.filter((buffer) => buffer.size === READBACK_SIZE)).toHaveLength(2);
      await vi.waitFor(() => {
        expect(gpu.submissionCount).toBe(1);
      });
      deferred[0]?.();
      await expect(first).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
        ndcDepth: 1,
      });
      await vi.waitFor(() => {
        expect(deferred).toHaveLength(2);
      });
      deferred[1]?.();
      await expect(second).resolves.toEqual({
        instancePickId: 1,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
        ndcDepth: 1,
      });
      const third = readPickPixel(gpu.device, canvas, pick, 3, 3);
      expect(gpu.buffers.filter((buffer) => buffer.size === READBACK_SIZE)).toHaveLength(2);
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
