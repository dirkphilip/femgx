/* eslint-disable jsdoc/require-jsdoc, max-lines-per-function */
import { COLOR_SAMPLE_COUNT } from "./gpu-support";
import { DEFORMATION_UNIFORM_SIZE } from "./gpu-deform";
import { createNodeOverlayPipelines } from "./gpu-node-overlay";
import type { NodeOverlayPipelines } from "./gpu-node-overlay";
import {
  createOrbitPivotPipeline,
  createOrbitPivotResources,
  type OrbitPivotResources,
} from "./gpu-orbit-pivot";
import { createPipelineResources, type DrawPipelines } from "./gpu-pipeline-builders";
import {
  createCompositeBindGroup,
  createCompositeResources,
  type CompositeResources,
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "./gpu-transparency";
import type { GpuValidationOptions } from "./gpu-validation";

export { COLOR_SAMPLE_COUNT } from "./gpu-support";
export type { DrawPipelines } from "./gpu-pipeline-builders";

export interface RenderResources {
  readonly cameraBuffer: GPUBuffer;
  readonly deformationBuffer: GPUBuffer;
  readonly frameBindGroup: GPUBindGroup;
  readonly pipelines: DrawPipelines;
  readonly composite: CompositeResources;
  readonly edgePipeline: GPURenderPipeline;
  readonly edgeAlwaysPipeline: GPURenderPipeline;
  /** Final FE-node visibility probe and annotation passes. */
  readonly nodeOverlayPipelines: NodeOverlayPipelines;
  /** Library-owned world-space camera-pivot indicator. */
  readonly orbitPivot: OrbitPivotResources;
  readonly instanceLayout: GPUBindGroupLayout;
}

interface DrawTargets {
  readonly device: GPUDevice;
  msaaColorTexture: GPUTexture | undefined;
  opaqueColorTexture: GPUTexture | undefined;
  msaaAccumulationTexture: GPUTexture | undefined;
  accumulationTexture: GPUTexture | undefined;
  msaaRevealageTexture: GPUTexture | undefined;
  revealageTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  depthWidth: number;
  depthHeight: number;
  compositeBindGroup: GPUBindGroup | undefined;
}

export const CAMERA_UNIFORM_SIZE = 112;

/** Creates validated pipelines before allocating the remaining frame resources. */
export async function createRenderResources(
  device: GPUDevice,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation?: GpuValidationOptions,
): Promise<RenderResources> {
  const instanceLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
    ],
  });
  const cameraLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [cameraLayout, instanceLayout],
  });
  const pipelineResources = await createPipelineResources(
    device,
    layout,
    format,
    depthFormat,
    validation,
  );
  const composite = await createCompositeResources(device, format, depthFormat, validation);
  const nodeOverlayPipelines = await createNodeOverlayPipelines({
    device,
    cameraLayout,
    instanceLayout,
    format,
    depthFormat,
    pointVertexModule: pipelineResources.pointVertexModule,
    validation,
  });
  const orbitPivotPipeline = await createOrbitPivotPipeline({
    device,
    format,
    depthFormat,
    validation,
  });
  let cameraBuffer: GPUBuffer | undefined;
  let deformationBuffer: GPUBuffer | undefined;
  let orbitPivot: OrbitPivotResources | undefined;
  try {
    cameraBuffer = device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    deformationBuffer = device.createBuffer({
      size: DEFORMATION_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    orbitPivot = createOrbitPivotResources({
      device,
      pipeline: orbitPivotPipeline,
      cameraBuffer,
      deformationBuffer,
    });
    const frameBindGroup = device.createBindGroup({
      layout: cameraLayout,
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: { buffer: deformationBuffer } },
      ],
    });
    return {
      cameraBuffer,
      deformationBuffer,
      frameBindGroup,
      instanceLayout,
      pipelines: pipelineResources.pipelines,
      composite,
      edgePipeline: pipelineResources.edgePipeline,
      edgeAlwaysPipeline: pipelineResources.edgeAlwaysPipeline,
      nodeOverlayPipelines,
      orbitPivot,
    };
  } catch (error) {
    orbitPivot?.buffer.destroy();
    cameraBuffer?.destroy();
    deformationBuffer?.destroy();
    throw error;
  }
}

export function destroyRenderResources(resources: RenderResources): void {
  resources.cameraBuffer.destroy();
  resources.deformationBuffer.destroy();
  resources.orbitPivot.buffer.destroy();
}

/** Allocates or reuses the multisampled color + depth targets for a visible frame. */
export function ensureColorTargets(
  draw: DrawTargets,
  width: number,
  height: number,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): {
  readonly color: GPUTexture;
  readonly depth: GPUTexture;
  readonly opaqueColor: GPUTexture;
  readonly accumulation: GPUTexture;
  readonly revealage: GPUTexture;
  readonly msaaAccumulation: GPUTexture;
  readonly msaaRevealage: GPUTexture;
} {
  if (
    draw.msaaColorTexture !== undefined &&
    draw.opaqueColorTexture !== undefined &&
    draw.msaaAccumulationTexture !== undefined &&
    draw.accumulationTexture !== undefined &&
    draw.msaaRevealageTexture !== undefined &&
    draw.revealageTexture !== undefined &&
    draw.depthTexture !== undefined &&
    draw.depthWidth === width &&
    draw.depthHeight === height
  ) {
    return {
      color: draw.msaaColorTexture,
      depth: draw.depthTexture,
      opaqueColor: draw.opaqueColorTexture,
      accumulation: draw.accumulationTexture,
      revealage: draw.revealageTexture,
      msaaAccumulation: draw.msaaAccumulationTexture,
      msaaRevealage: draw.msaaRevealageTexture,
    };
  }
  draw.msaaColorTexture?.destroy();
  draw.opaqueColorTexture?.destroy();
  draw.msaaAccumulationTexture?.destroy();
  draw.accumulationTexture?.destroy();
  draw.msaaRevealageTexture?.destroy();
  draw.revealageTexture?.destroy();
  draw.depthTexture?.destroy();
  draw.msaaColorTexture = draw.device.createTexture({
    size: [width, height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: colorFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  draw.opaqueColorTexture = draw.device.createTexture({
    size: [width, height],
    format: colorFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  draw.msaaAccumulationTexture = draw.device.createTexture({
    size: [width, height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: TRANSPARENCY_ACCUMULATION_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  draw.accumulationTexture = draw.device.createTexture({
    size: [width, height],
    format: TRANSPARENCY_ACCUMULATION_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  draw.msaaRevealageTexture = draw.device.createTexture({
    size: [width, height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: TRANSPARENCY_REVEALAGE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  draw.revealageTexture = draw.device.createTexture({
    size: [width, height],
    format: TRANSPARENCY_REVEALAGE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  draw.depthTexture = draw.device.createTexture({
    size: [width, height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  draw.depthWidth = width;
  draw.depthHeight = height;
  draw.compositeBindGroup = undefined;
  return {
    color: draw.msaaColorTexture,
    depth: draw.depthTexture,
    opaqueColor: draw.opaqueColorTexture,
    accumulation: draw.accumulationTexture,
    revealage: draw.revealageTexture,
    msaaAccumulation: draw.msaaAccumulationTexture,
    msaaRevealage: draw.msaaRevealageTexture,
  };
}

/** Ensures the composite bind group addresses the current-size resolved targets. */
export function ensureCompositeBindGroup(
  draw: DrawTargets,
  resources: RenderResources,
): GPUBindGroup {
  if (draw.compositeBindGroup !== undefined) return draw.compositeBindGroup;
  if (
    draw.opaqueColorTexture === undefined ||
    draw.accumulationTexture === undefined ||
    draw.revealageTexture === undefined
  ) {
    throw new Error("Transparency targets are not initialized");
  }
  draw.compositeBindGroup = createCompositeBindGroup(
    draw.device,
    resources.composite.layout,
    draw.opaqueColorTexture.createView(),
    draw.accumulationTexture.createView(),
    draw.revealageTexture.createView(),
  );
  return draw.compositeBindGroup;
}

/** Begins the visible color render pass with a cleared multisampled depth attachment. */
export function beginColorPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  resolveTarget: GPUTextureView | undefined,
): GPURenderPassEncoder {
  const colorAttachment: GPURenderPassColorAttachment = {
    view: colorView,
    clearValue: { r: 0.91, g: 0.93, b: 0.95, a: 1 },
    loadOp: "clear",
    storeOp: resolveTarget === undefined ? "store" : "discard",
  };
  if (resolveTarget !== undefined) colorAttachment.resolveTarget = resolveTarget;
  return encoder.beginRenderPass({
    colorAttachments: [colorAttachment],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
      stencilClearValue: 0,
      stencilLoadOp: "clear",
      stencilStoreOp: "discard",
    },
  });
}

/** Begins the weighted transparency accumulation pass over the opaque depth. */
export interface TransparencyPassTargets {
  readonly accumulationView: GPUTextureView;
  readonly accumulationResolve: GPUTextureView;
  readonly revealageView: GPUTextureView;
  readonly revealageResolve: GPUTextureView;
}

export function beginTransparencyPass(
  encoder: GPUCommandEncoder,
  targets: TransparencyPassTargets,
  depthView: GPUTextureView,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: targets.accumulationView,
        resolveTarget: targets.accumulationResolve,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "discard",
      },
      {
        view: targets.revealageView,
        resolveTarget: targets.revealageResolve,
        clearValue: { r: 1, g: 1, b: 1, a: 1 },
        loadOp: "clear",
        storeOp: "discard",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthLoadOp: "load",
      depthStoreOp: "store",
      stencilLoadOp: "load",
      stencilStoreOp: "discard",
    },
  });
}

/** Begins the final composite pass and leaves its depth available for overlays. */
export function beginCompositePass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  resolveTarget: GPUTextureView,
  depthView: GPUTextureView,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        resolveTarget,
        clearValue: { r: 0.91, g: 0.93, b: 0.95, a: 1 },
        loadOp: "clear",
        storeOp: "discard",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthLoadOp: "load",
      depthStoreOp: "store",
      stencilLoadOp: "load",
      stencilStoreOp: "discard",
    },
  });
}
