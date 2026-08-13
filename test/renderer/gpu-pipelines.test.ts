import { describe, expect, it } from "vitest";
import { createRenderResources, destroyRenderResources } from "../../src/renderer/gpu-pipelines";
import { COLOR_SAMPLE_COUNT } from "../../src/renderer/gpu-support";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("GPU render resources", () => {
  it("creates the camera buffer, bind group, and color and id pipelines", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resources = await createRenderResources(gpu.device, "bgra8unorm", "depth24plus");
      expect(resources.cameraBuffer).toBeDefined();
      expect(resources.deformationBuffer).toBeDefined();
      expect(resources.frameBindGroup).toBeDefined();
      expect(resources.pipelines.trianglesColor).toBeDefined();
      expect(resources.pipelines.trianglesTransparent).toBeDefined();
      expect(resources.pipelines.trianglesPick).toBeDefined();
      expect(resources.pipelines.linesColor).toBeDefined();
      expect(resources.pipelines.linesTransparent).toBeDefined();
      expect(resources.pipelines.linesPick).toBeDefined();
      expect(resources.pipelines.pointsColor).toBeDefined();
      expect(resources.pipelines.pointsTransparent).toBeDefined();
      expect(resources.pipelines.pointsPick).toBeDefined();
      const pipelineVertex = (label: string): GPUShaderModule | undefined =>
        gpu.renderPipelineDescriptors.find((descriptor) => descriptor.label === label)?.vertex
          .module;
      expect(pipelineVertex("triangle color")).not.toBe(pipelineVertex("line color"));
      expect(pipelineVertex("triangle selection visible")).not.toBe(
        pipelineVertex("line selection visible"),
      );
      for (const label of ["triangle picking", "line picking", "point picking"]) {
        const picking = gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === label,
        );
        expect(picking?.fragment?.targets).toHaveLength(4);
      }
      const transparent = gpu.renderPipelineDescriptors.filter(
        (descriptor) => descriptor.fragment?.targets.length === 2,
      );
      expect(transparent).toHaveLength(9);
      expect(
        transparent.every((descriptor) => descriptor.depthStencil?.depthWriteEnabled === false),
      ).toBe(true);
      expect(transparent[0]?.fragment?.targets[0]?.blend?.color).toEqual({
        srcFactor: "one",
        dstFactor: "one",
      });
      expect(transparent[0]?.fragment?.targets[1]?.blend?.color).toEqual({
        srcFactor: "zero",
        dstFactor: "one-minus-src",
      });
      expect(resources.composite).toBeDefined();
      expect(resources.edgePipeline).toBeDefined();
      expect(resources.edgeAlwaysPipeline).toBeDefined();
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.depthStencil?.depthCompare === "less-equal",
        ),
      ).toBeDefined();
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.depthStencil?.depthCompare === "always",
        ),
      ).toBeDefined();
      expect(resources.nodeOverlayPipelines.visible).toBeDefined();
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "node selection visible",
        )?.vertex.entryPoint,
      ).toBe("nodeOverlayVertexMain");
      expect(resources.originTriad?.visiblePipeline).toBeDefined();
      expect(resources.originTriad?.hiddenPipeline).toBeDefined();
      const originVisible = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "world-origin triad visible",
      );
      expect(originVisible?.depthStencil).toMatchObject({
        depthCompare: "less-equal",
        depthWriteEnabled: false,
        stencilFront: { compare: "always", passOp: "replace" },
        stencilWriteMask: 1,
      });
      const originHidden = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "world-origin triad hidden",
      );
      expect(originHidden?.depthStencil).toMatchObject({
        depthCompare: "greater",
        depthWriteEnabled: false,
        stencilFront: { compare: "not-equal", passOp: "keep" },
        stencilWriteMask: 0,
      });
      expect(originHidden?.fragment?.targets).toHaveLength(2);
      const selectionVisible = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "triangle selection visible",
      );
      expect(selectionVisible?.depthStencil).toMatchObject({
        depthCompare: "less-equal",
        depthWriteEnabled: false,
        stencilFront: { compare: "always", passOp: "replace" },
        stencilReadMask: 2,
        stencilWriteMask: 2,
      });
      expect(selectionVisible?.fragment?.targets[0]?.blend).toEqual({
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      });
      const selectionHidden = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "triangle selection hidden",
      );
      expect(selectionHidden?.depthStencil).toMatchObject({
        depthCompare: "greater",
        depthWriteEnabled: false,
        stencilFront: { compare: "not-equal", passOp: "keep" },
        stencilReadMask: 2,
        stencilWriteMask: 0,
      });
      expect(resources.orbitPivot.visiblePipeline).toBeDefined();
      expect(resources.orbitPivot.hiddenPipeline).toBeDefined();
      const pivotVisible = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "orbit pivot visible",
      );
      expect(pivotVisible?.depthStencil).toMatchObject({
        depthCompare: "less-equal",
        depthWriteEnabled: true,
      });
      expect(pivotVisible?.fragment?.targets).toEqual([{ format: "bgra8unorm" }]);
      const pivotHidden = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "orbit pivot hidden",
      );
      expect(pivotHidden?.depthStencil).toMatchObject({
        depthCompare: "greater",
        depthWriteEnabled: false,
      });
      expect(pivotHidden?.fragment?.targets).toHaveLength(2);
      expect(resources.background.pipeline).toBeDefined();
      expect(resources.background.bindGroup).toBeDefined();
      expect(resources.background.buffer).toBeDefined();
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "viewport background",
        )?.depthStencil,
      ).toMatchObject({
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "always",
        stencilWriteMask: 0,
      });
      const nodePipeline = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "node annotation overlay",
      );
      expect(nodePipeline?.depthStencil).toMatchObject({
        depthCompare: "less-equal",
        depthWriteEnabled: false,
      });
      expect(nodePipeline?.multisample?.count).toBe(COLOR_SAMPLE_COUNT);
      expect(nodePipeline?.multisample?.alphaToCoverageEnabled).toBe(true);
      expect(nodePipeline?.fragment?.targets[0]?.blend).toBeUndefined();
      expect(gpu.renderPipelineDescriptors[0]?.multisample?.count).toBe(COLOR_SAMPLE_COUNT);
      expect(gpu.renderPipelineDescriptors[2]?.multisample?.count ?? 1).toBe(1);
      expect(resources.instanceLayout).toBeDefined();
      expect(gpu.renderPipelineDescriptors[0]?.primitive?.cullMode).toBe("none");
      expect(gpu.renderPipelineDescriptors[1]?.primitive?.cullMode).toBe("none");
      expect(resources.background.buffer).toHaveProperty("size", 32);
      expect(gpu.buffers).toHaveLength(5);
      destroyRenderResources(resources);
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      restore();
    }
  });
});
