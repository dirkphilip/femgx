import { describe, expect, it } from "vitest";
import {
  createBackgroundResources,
  destroyBackgroundResources,
  resolveBackgroundColors,
  writeBackgroundColors,
} from "../../src/renderer/gpu-background";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("viewport background", () => {
  it("resolves studio as a materially separated cool-neutral gradient", () => {
    const studio = resolveBackgroundColors("studio");
    const luminance = (color: readonly number[]) =>
      (color[0] ?? 0) * 0.2126 + (color[1] ?? 0) * 0.7152 + (color[2] ?? 0) * 0.0722;
    const contrast = (luminance(studio.top) - luminance(studio.bottom)) * 255;

    expect(contrast).toBeGreaterThanOrEqual(32);
    expect(contrast).toBeLessThanOrEqual(80);
    expect(luminance(studio.top)).toBeLessThan(luminance([1, 1, 1, 1]));
    expect(resolveBackgroundColors("white").top).toEqual([1, 1, 1, 1]);
    expect(resolveBackgroundColors("white").bottom).toEqual([1, 1, 1, 1]);
    expect(resolveBackgroundColors("dark").top[0]).toBeGreaterThan(
      resolveBackgroundColors("dark").bottom[0],
    );
  });

  it("updates one uniform without creating another pipeline", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resources = await createBackgroundResources(
        gpu.device,
        {} as GPUBindGroupLayout,
        "bgra8unorm",
        "depth24plus-stencil8",
      );
      const pipelineCount = gpu.renderPipelineDescriptors.length;
      const buffer = resources.buffer;
      writeBackgroundColors(gpu.device, resources, "dark");
      const write = gpu.writes.at(-1);
      expect(write?.buffer).toBe(buffer);
      expect(write?.bytes.byteLength).toBe(32);
      expect(gpu.renderPipelineDescriptors).toHaveLength(pipelineCount);
      destroyBackgroundResources(resources);
      expect(gpu.buffers.find((record) => record.resource === buffer)?.destroyed).toBe(true);
    } finally {
      restore();
    }
  });
});
