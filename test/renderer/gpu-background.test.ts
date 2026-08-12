import { describe, expect, it } from "vitest";
import {
  createBackgroundResources,
  destroyBackgroundResources,
  resolveBackgroundColors,
  writeBackgroundColors,
} from "../../src/renderer/gpu-background";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("viewport background", () => {
  it("resolves studio as a lighter top and darker bottom gradient", () => {
    const studio = resolveBackgroundColors("studio");
    expect(studio.top[0]).toBeGreaterThan(studio.bottom[0]);
    expect(studio.top[1]).toBeGreaterThan(studio.bottom[1]);
    expect(studio.top[2]).toBeGreaterThan(studio.bottom[2]);
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
