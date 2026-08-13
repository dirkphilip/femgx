/* eslint-disable jsdoc/require-jsdoc */
import { COLOR_SAMPLE_COUNT } from "./gpu-support";
import {
  createBackgroundResources,
  destroyBackgroundResources,
  type BackgroundResources,
} from "./gpu-background";
import { DEFORMATION_UNIFORM_SIZE } from "./gpu-deform";
import { createNodeOverlayPipelines } from "./gpu-node-overlay";
import type { NodeOverlayPipelines } from "./gpu-node-overlay";
import {
  createOrbitPivotPipeline,
  createOrbitPivotResources,
  type OrbitPivotResources,
} from "./gpu-orbit-pivot";
import {
  createOriginTriadPipeline,
  createOriginTriadResources,
  type OriginTriadResources,
} from "./gpu-origin-triad";
import { createPipelineResources, type DrawPipelines } from "./gpu-pipeline-builders";
import {
  createCompositeBindGroup,
  createCompositeResources,
  type CompositeResources,
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "./gpu-transparency";
import {
  createColorTargets,
  destroyColorTargets,
  type ColorTargetOwner,
  type ColorTargets,
} from "./gpu-targets";
import type { GpuValidationOptions } from "./gpu-validation";

export { beginColorPass, beginCompositePass, beginTransparencyPass } from "./gpu-passes";

export { COLOR_SAMPLE_COUNT } from "./gpu-support";
export type { DrawPipelines } from "./gpu-pipeline-builders";

interface ReadyColorTargets {
  readonly color: GPUTexture;
  readonly depth: GPUTexture;
  readonly opaqueColor: GPUTexture;
  readonly accumulation: GPUTexture;
  readonly revealage: GPUTexture;
  readonly msaaAccumulation: GPUTexture;
  readonly msaaRevealage: GPUTexture;
}

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
  /** Persistent world-origin triad with visible and weighted-ghost variants. */
  readonly originTriad: OriginTriadResources;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly background: BackgroundResources;
}

export const CAMERA_UNIFORM_SIZE = 128;

/** Creates validated pipelines before allocating the remaining frame resources. */
// eslint-disable-next-line max-lines-per-function -- pipeline creation is one validated resource transaction.
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
  const originTriadPipeline = await createOriginTriadPipeline({
    device,
    cameraLayout,
    format,
    depthFormat,
    validation,
  });
  let background: BackgroundResources | undefined;
  let cameraBuffer: GPUBuffer | undefined;
  let deformationBuffer: GPUBuffer | undefined;
  let orbitPivot: OrbitPivotResources | undefined;
  let originTriad: OriginTriadResources | undefined;
  try {
    background = await createBackgroundResources(
      device,
      cameraLayout,
      format,
      depthFormat,
      validation,
    );
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
    originTriad = createOriginTriadResources({
      device,
      pipeline: originTriadPipeline,
      frameBindGroup,
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
      originTriad,
      background,
    };
  } catch (error) {
    if (background !== undefined) destroyBackgroundResources(background);
    orbitPivot?.buffer.destroy();
    originTriad?.buffer.destroy();
    cameraBuffer?.destroy();
    deformationBuffer?.destroy();
    throw error;
  }
}

export function destroyRenderResources(resources: RenderResources): void {
  resources.cameraBuffer.destroy();
  resources.deformationBuffer.destroy();
  resources.orbitPivot.buffer.destroy();
  resources.originTriad.buffer.destroy();
  destroyBackgroundResources(resources.background);
}

/** Allocates or reuses the multisampled color + depth targets for a visible frame. */
export function ensureColorTargets(
  draw: ColorTargetOwner,
  width: number,
  height: number,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): ReadyColorTargets {
  const cached = cachedColorTargets(draw.targets, width, height);
  if (cached !== undefined) return cached;
  destroyColorTargets(draw.targets);
  const next = allocateColorTargets(draw, width, height, colorFormat, depthFormat);
  publishColorTargets(draw.targets, next, width, height);
  return next;
}

function cachedColorTargets(
  targets: ColorTargets,
  width: number,
  height: number,
): ReadyColorTargets | undefined {
  if (targets.depthWidth !== width || targets.depthHeight !== height) return undefined;
  try {
    return readyColorTargets(targets);
  } catch {
    return undefined;
  }
}

function allocateColorTargets(
  draw: ColorTargetOwner,
  width: number,
  height: number,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): ReadyColorTargets {
  const next = createColorTargets();
  try {
    next.msaaColorTexture = draw.device.createTexture({
      size: [width, height],
      sampleCount: COLOR_SAMPLE_COUNT,
      format: colorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    next.opaqueColorTexture = draw.device.createTexture({
      size: [width, height],
      format: colorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    next.msaaAccumulationTexture = draw.device.createTexture({
      size: [width, height],
      sampleCount: COLOR_SAMPLE_COUNT,
      format: TRANSPARENCY_ACCUMULATION_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    next.accumulationTexture = draw.device.createTexture({
      size: [width, height],
      format: TRANSPARENCY_ACCUMULATION_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    next.msaaRevealageTexture = draw.device.createTexture({
      size: [width, height],
      sampleCount: COLOR_SAMPLE_COUNT,
      format: TRANSPARENCY_REVEALAGE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    next.revealageTexture = draw.device.createTexture({
      size: [width, height],
      format: TRANSPARENCY_REVEALAGE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    next.depthTexture = draw.device.createTexture({
      size: [width, height],
      sampleCount: COLOR_SAMPLE_COUNT,
      format: depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return readyColorTargets(next);
  } catch (error) {
    destroyColorTargets(next);
    throw error;
  }
}

function readyColorTargets(targets: ColorTargets): ReadyColorTargets {
  const {
    msaaColorTexture,
    opaqueColorTexture,
    msaaAccumulationTexture,
    accumulationTexture,
    msaaRevealageTexture,
    revealageTexture,
    depthTexture,
  } = targets;
  if (
    msaaColorTexture === undefined ||
    opaqueColorTexture === undefined ||
    msaaAccumulationTexture === undefined ||
    accumulationTexture === undefined ||
    msaaRevealageTexture === undefined ||
    revealageTexture === undefined ||
    depthTexture === undefined
  ) {
    throw new Error("Visible color targets are incomplete");
  }
  return {
    color: msaaColorTexture,
    depth: depthTexture,
    opaqueColor: opaqueColorTexture,
    accumulation: accumulationTexture,
    revealage: revealageTexture,
    msaaAccumulation: msaaAccumulationTexture,
    msaaRevealage: msaaRevealageTexture,
  };
}

function publishColorTargets(
  targets: ColorTargets,
  next: ReadyColorTargets,
  width: number,
  height: number,
): void {
  targets.msaaColorTexture = next.color;
  targets.opaqueColorTexture = next.opaqueColor;
  targets.msaaAccumulationTexture = next.msaaAccumulation;
  targets.accumulationTexture = next.accumulation;
  targets.msaaRevealageTexture = next.msaaRevealage;
  targets.revealageTexture = next.revealage;
  targets.depthTexture = next.depth;
  targets.depthWidth = width;
  targets.depthHeight = height;
  targets.compositeBindGroup = undefined;
}

/** Ensures the composite bind group addresses the current-size resolved targets. */
export function ensureCompositeBindGroup(
  draw: ColorTargetOwner,
  resources: RenderResources,
): GPUBindGroup {
  if (draw.targets.compositeBindGroup !== undefined) return draw.targets.compositeBindGroup;
  if (
    draw.targets.opaqueColorTexture === undefined ||
    draw.targets.accumulationTexture === undefined ||
    draw.targets.revealageTexture === undefined
  ) {
    throw new Error("Transparency targets are not initialized");
  }
  draw.targets.compositeBindGroup = createCompositeBindGroup(
    draw.device,
    resources.composite.layout,
    draw.targets.opaqueColorTexture.createView(),
    draw.targets.accumulationTexture.createView(),
    draw.targets.revealageTexture.createView(),
  );
  return draw.targets.compositeBindGroup;
}
