import { describe, expect, it } from "vitest";
import { createRenderResources, destroyRenderResources } from "../../src/renderer/gpu-pipelines";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("GPU render resources", () => {
  it("creates the camera buffer, bind group, and both pipelines", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resources = createRenderResources(gpu.device, "bgra8unorm", "depth24plus");
      expect(resources.cameraBuffer).toBeDefined();
      expect(resources.cameraBindGroup).toBeDefined();
      expect(resources.colorPipeline).toBeDefined();
      expect(resources.pickPipeline).toBeDefined();
      expect(resources.instanceLayout).toBeDefined();
      expect(gpu.buffers).toHaveLength(1);
      destroyRenderResources(resources);
      expect(gpu.buffers[0]?.destroyed).toBe(true);
    } finally {
      restore();
    }
  });
});
