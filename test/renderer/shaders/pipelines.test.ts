import { describe, expect, it } from "vitest";
import { createRenderResources, destroyRenderResources } from "@/renderer/frame/pipelines";
import { SECTION_PLANE_UNIFORM_SIZE } from "@/renderer/frame/section-plane";
import { COLOR_SAMPLE_COUNT } from "@/renderer/resources/foundation";
import { pipelineFor } from "@/renderer/frame/draw-admission";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";
import type { DrawPipelines } from "@/renderer/shaders/pipeline-builders";

it("admits the native depth-bias pipeline only for active dense selection", () => {
  const ordinary = { name: "ordinary" } as unknown as GPURenderPipeline;
  const denseSelection = { name: "dense-selection" } as unknown as GPURenderPipeline;
  const pipelines = {
    trianglesColor: ordinary,
    denseSelectionTrianglesColor: denseSelection,
  } as unknown as DrawPipelines;
  expect(pipelineFor("triangles", "color", pipelines, "feature")).toBe(ordinary);
  expect(pipelineFor("triangles", "color", pipelines, "feature", true)).toBe(denseSelection);
});

describe("GPU render resources", () => {
  it("creates the camera buffer, bind group, and color and id pipelines", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resources = await createRenderResources(gpu.device, "bgra8unorm", "depth24plus");
      const vertexStorageCounts = gpu.bindGroupLayoutDescriptors.map(
        (descriptor) =>
          [...descriptor.entries].filter(
            (entry) =>
              entry.buffer?.type === "read-only-storage" &&
              (entry.visibility & GPUShaderStage.VERTEX) !== 0,
          ).length,
      );
      expect(Math.max(...vertexStorageCounts)).toBeLessThanOrEqual(8);
      expect(resources.cameraBuffer).toBeDefined();
      expect(resources.deformationBuffer).toBeDefined();
      expect(resources.frameBindGroup).toBeDefined();
      expect(resources.minimalFrameBindGroup).toBeDefined();
      expect(resources.minimalInstanceLayout).toBeDefined();
      expect(resources.pipelines.minimalTrianglesColor).toBeDefined();
      expect(resources.pipelines.minimalTrianglesTransparent).toBeDefined();
      expect(resources.pipelines.trianglesColor).toBeDefined();
      expect(resources.pipelines.denseSelectionTrianglesColor).toBeDefined();
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
      expect(pipelineVertex("dense-selection triangle color")).toBe(
        pipelineVertex("triangle color"),
      );
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "dense-selection triangle color",
        )?.depthStencil?.depthBias,
      ).toBe(-1);
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
      expect(transparent).toHaveLength(11);
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
      expect(
        gpu.renderPipelineDescriptors.find((descriptor) => descriptor.label === "line color")
          ?.depthStencil?.depthCompare,
      ).toBe("less-equal");
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "triangle transparency",
        )?.depthStencil?.depthCompare,
      ).toBe("less-equal");
      const edgeDepthTested = gpu.renderPipelineDescriptors.find(
        (descriptor) => descriptor.label === "edge overlay depth-tested",
      );
      expect(edgeDepthTested?.primitive?.topology).toBe("line-list");
      expect(edgeDepthTested?.depthStencil).toMatchObject({
        depthCompare: "less-equal",
        depthWriteEnabled: false,
      });
      expect(edgeDepthTested?.depthStencil?.depthBias).toBeUndefined();
      expect(edgeDepthTested?.multisample?.count).toBe(COLOR_SAMPLE_COUNT);
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "edge overlay always-visible",
        )?.depthStencil?.depthCompare,
      ).toBe("always");
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "node annotation overlay",
        )?.multisample?.count,
      ).toBe(COLOR_SAMPLE_COUNT);
      expect(
        gpu.renderPipelineDescriptors.find((descriptor) => descriptor.label === "line picking")
          ?.depthStencil?.depthCompare,
      ).toBe("less-equal");
      expect(resources.composite).toBeDefined();
      expect(resources.edgePipeline).toBeDefined();
      expect(resources.edgeAlwaysPipeline).toBeDefined();
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.depthStencil?.depthCompare === "less-equal",
        ),
      ).toBeDefined();
      expect(resources.nodeOverlayPipelines.visible).toBeDefined();
      expect(resources.orientationGlyphs.visible).toBeDefined();
      expect(resources.orientationGlyphs.hidden).toBeDefined();
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "node selection visible",
        )?.vertex.entryPoint,
      ).toBe("nodeOverlayVertexMain");
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "node selection visible",
        )?.vertex.buffers,
      ).toEqual([]);
      expect(
        gpu.renderPipelineDescriptors.find(
          (descriptor) => descriptor.label === "point selection visible",
        )?.vertex.buffers,
      ).toHaveLength(1);
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
        depthBias: -1,
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
      expect(nodePipeline?.vertex.buffers).toEqual([]);
      expect(nodePipeline?.fragment?.targets[0]?.blend).toBeUndefined();
      expect(gpu.renderPipelineDescriptors[0]?.multisample?.count).toBe(COLOR_SAMPLE_COUNT);
      expect(gpu.renderPipelineDescriptors[2]?.multisample?.count ?? 1).toBe(1);
      expect(resources.instanceLayout).toBeDefined();
      expect(gpu.renderPipelineDescriptors[0]?.primitive?.cullMode).toBe("none");
      expect(gpu.renderPipelineDescriptors[1]?.primitive?.cullMode).toBe("none");
      expect(resources.background.buffer).toHaveProperty("size", 32);
      expect(resources.sectionPlaneBuffer).toHaveProperty("size", SECTION_PLANE_UNIFORM_SIZE);
      expect(gpu.buffers).toHaveLength(6);
      destroyRenderResources(resources);
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      restore();
    }
  });
});
