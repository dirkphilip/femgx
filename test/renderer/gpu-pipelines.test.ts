import { describe, expect, it } from "vitest";
import { createRenderResources, destroyRenderResources } from "../../src/renderer/gpu-pipelines";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("GPU render resources", () => {
  it("creates the camera buffer, bind group, and color and id pipelines", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resources = createRenderResources(gpu.device, "bgra8unorm", "depth24plus");
      expect(resources.cameraBuffer).toBeDefined();
      expect(resources.deformationBuffer).toBeDefined();
      expect(resources.frameBindGroup).toBeDefined();
      expect(resources.pipelines.trianglesColor).toBeDefined();
      expect(resources.pipelines.trianglesPick).toBeDefined();
      expect(resources.pipelines.linesColor).toBeDefined();
      expect(resources.pipelines.linesPick).toBeDefined();
      expect(resources.pipelines.pointsColor).toBeDefined();
      expect(resources.pipelines.pointsPick).toBeDefined();
      for (const index of [1, 3, 5]) {
        expect(gpu.renderPipelineDescriptors[index]?.fragment?.targets).toHaveLength(4);
      }
      expect(resources.edgePipeline).toBeDefined();
      expect(resources.edgeAlwaysPipeline).toBeDefined();
      expect(gpu.renderPipelineDescriptors.at(-4)?.depthStencil?.depthCompare).toBe("less-equal");
      expect(gpu.renderPipelineDescriptors.at(-3)?.depthStencil?.depthCompare).toBe("always");
      expect(resources.nodeOverlayPipelines.visible).toBeDefined();
      const nodePipeline = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.vertex.entryPoint === "nodeOverlayVertexMain",
      );
      expect(nodePipeline?.depthStencil).toMatchObject({
        depthCompare: "always",
        depthWriteEnabled: false,
      });
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
