import { describe, expect, it } from "vitest";
import { createRenderResources, destroyRenderResources } from "../../src/renderer/gpu-pipelines";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("GPU render resources", () => {
  it("creates the camera buffer, bind group, and color, id, and depth pipelines", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resources = createRenderResources(gpu.device, "bgra8unorm", "depth24plus");
      expect(resources.cameraBuffer).toBeDefined();
      expect(resources.deformationBuffer).toBeDefined();
      expect(resources.frameBindGroup).toBeDefined();
      expect(resources.pipelines.trianglesColor).toBeDefined();
      expect(resources.pipelines.trianglesPick).toBeDefined();
      expect(resources.pipelines.trianglesDepth).toBeDefined();
      expect(resources.pipelines.linesColor).toBeDefined();
      expect(resources.pipelines.linesPick).toBeDefined();
      expect(resources.pipelines.linesDepth).toBeDefined();
      expect(resources.pipelines.pointsColor).toBeDefined();
      expect(resources.pipelines.pointsPick).toBeDefined();
      expect(resources.pipelines.pointsDepth).toBeDefined();
      for (const index of [1, 4, 7]) {
        expect(gpu.renderPipelineDescriptors[index]?.fragment?.targets).toHaveLength(4);
      }
      for (const index of [2, 5, 8]) {
        expect(gpu.renderPipelineDescriptors[index]?.fragment?.targets).toHaveLength(1);
        expect(gpu.renderPipelineDescriptors[index]?.fragment?.targets[0]?.format).toBe("r32float");
      }
      expect(resources.edgePipeline).toBeDefined();
      expect(resources.edgeAlwaysPipeline).toBeDefined();
      expect(gpu.renderPipelineDescriptors.at(-4)?.depthStencil?.depthCompare).toBe("less-equal");
      expect(gpu.renderPipelineDescriptors.at(-3)?.depthStencil?.depthCompare).toBe("always");
      expect(resources.nodeOverlayPipelines.visible).toBeDefined();
      expect(resources.instanceLayout).toBeDefined();
      expect(gpu.renderPipelineDescriptors[0]?.primitive?.cullMode).toBe("none");
      expect(gpu.renderPipelineDescriptors[1]?.primitive?.cullMode).toBe("none");
      expect(gpu.buffers).toHaveLength(3);
      destroyRenderResources(resources);
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      restore();
    }
  });
});
