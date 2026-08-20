import { expect, it, describe } from "vitest";
import {
  createDrawResources,
  destroyDrawResources,
  patchInstances,
  writeDrawOrder,
  drawBatches,
  ensureColorTargets,
  beginColorPass,
  fakeGpuDevice,
  installGpuGlobals,
  part,
  record,
  drawContext,
} from "./support";

describe("GPU draw path", () => {
  it("creates a new bind group when the storage grows", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "color",
      });
      pass.end();
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
        { slot: 2, data: record(2) },
      ]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const encoder2 = gpu.device.createCommandEncoder();
      const pass2 = beginColorPass(
        encoder2,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass2, draw, drawContext(), [{ partId: part.id, instanceCount: 3 }], {
        kind: "surface",
        pass: "color",
      });
      pass2.end();
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });

  it("reuses multisampled color targets and only resizes when the canvas size changes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const first = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
      });
      const second = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
      });
      expect(second.color).toBe(first.color);
      expect(second.depth).toBe(first.depth);
      expect(gpu.textureCreations).toBe(7);
      expect(gpu.textures[0]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[1]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[1]?.descriptor.usage).toBe(
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      );
      expect(gpu.textures[2]?.descriptor.sampleCount).toBeUndefined();
      expect(gpu.textures[3]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[4]?.descriptor.sampleCount).toBeUndefined();
      expect(gpu.textures[5]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[6]?.descriptor.sampleCount).toBeUndefined();
      draw.targets.compositeBindGroup = {} as GPUBindGroup;
      const resized = ensureColorTargets(draw, {
        width: 400,
        height: 300,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
      });
      expect(resized.depth).not.toBe(first.depth);
      expect(gpu.textureCreations).toBe(14);
      expect(gpu.textures[0]?.destroyed).toBe(true);
      expect(gpu.textures[1]?.destroyed).toBe(true);
      expect(draw.targets.compositeBindGroup).toBeUndefined();
      destroyDrawResources(draw);
      destroyDrawResources(draw);
      expect(gpu.textures.slice(7).every((texture) => texture.destroyed)).toBe(true);
      expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
    } finally {
      restore();
    }
  });

  it("allocates and releases weighted targets independently of base color and depth", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const opaque = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: false,
      });
      expect(gpu.textureCreations).toBe(2);
      expect(opaque.opaqueColor).toBeUndefined();
      expect(opaque.accumulation).toBeUndefined();
      const weighted = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: true,
      });
      expect(gpu.textureCreations).toBe(7);
      expect(weighted.color).toBe(opaque.color);
      expect(weighted.depth).toBe(opaque.depth);
      expect(weighted.opaqueColor).toBeDefined();
      const released = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: false,
      });
      expect(gpu.textureCreations).toBe(7);
      expect(released.color).toBe(opaque.color);
      expect(released.opaqueColor).toBeUndefined();
      expect(gpu.textures.slice(2).every((texture) => texture.destroyed)).toBe(true);
      destroyDrawResources(draw);
    } finally {
      restore();
    }
  });

  it("allocates resolved presentation depth only while native edge display is active", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const inactive = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: false,
      });
      expect(inactive.overlayDepth).toBeUndefined();
      const active = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: false,
        requiresOverlays: true,
      });
      expect(active.overlayDepth).toBeDefined();
      expect(gpu.textureCreations).toBe(3);
      const released = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: false,
      });
      expect(released.overlayDepth).toBeUndefined();
      expect(gpu.textures[2]?.destroyed).toBe(true);
      destroyDrawResources(draw);
    } finally {
      restore();
    }
  });

  it("cleans partial visible-target allocation without publishing half-state", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ textureCreationErrorAt: 4 });
      const draw = createDrawResources(gpu.device);

      expect(() => {
        ensureColorTargets(draw, {
          width: 800,
          height: 600,
          colorFormat: "bgra8unorm",
          depthFormat: "depth24plus-stencil8",
        });
      }).toThrow("fake texture allocation failed at 4");
      expect(gpu.textureCreations).toBe(3);
      expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
      expect(draw.targets.msaaColorTexture).toBeUndefined();
      expect(draw.targets.opaqueColorTexture).toBeUndefined();
      expect(draw.targets.depthTexture).toBeUndefined();
      expect(draw.targets.depthWidth).toBe(0);
      expect(draw.targets.depthHeight).toBe(0);
      expect(draw.targets.compositeBindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });
});
