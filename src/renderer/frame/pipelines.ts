/* eslint-disable jsdoc/require-jsdoc */
import {
  createBackgroundResources,
  destroyBackgroundResources,
  type BackgroundResources,
} from "./background";
import { DEFORMATION_UNIFORM_SIZE } from "./deformation";
import { SECTION_PLANE_UNIFORM_SIZE } from "../frame/section-plane";
import { createNodeOverlayPipelines } from "../shaders/node-overlay";
import type { NodeOverlayPipelines } from "../shaders/node-overlay";
import {
  createOrbitPivotPipeline,
  createOrbitPivotResources,
  type OrbitPivotResources,
} from "../overlays/orbit-pivot";
import {
  createOriginTriadPipeline,
  createOriginTriadResources,
  type OriginTriadResources,
} from "../overlays/origin-triad";
import { createPipelineResources, type DrawPipelines } from "../shaders/pipeline-builders";
import {
  createOrientationGlyphPipelines,
  type OrientationGlyphPipelines,
} from "../orientation-glyphs/pipelines";
import {
  createCompositeBindGroup,
  createCompositeResources,
  type CompositeResources,
} from "./transparency";
import type { ColorTargetOwner } from "../resources/color-targets";
import type { GpuValidationOptions } from "../diagnostics/validation";
import {
  createOverlayDepthBindGroup,
  createOverlayDepthResources,
  type OverlayDepthResources,
} from "./overlay-depth";

export type { DrawPipelines } from "../shaders/pipeline-builders";
export { ensureColorTargets } from "../resources/color-targets";

export interface RenderResources {
  readonly cameraBuffer: GPUBuffer;
  readonly deformationBuffer: GPUBuffer;
  readonly sectionPlaneBuffer: GPUBuffer;
  readonly frameBindGroup: GPUBindGroup;
  readonly pipelines: DrawPipelines;
  readonly orientationGlyphs: OrientationGlyphPipelines;
  readonly composite: CompositeResources;
  readonly edgePipeline: GPURenderPipeline;
  readonly edgeAlwaysPipeline: GPURenderPipeline;
  /** Final FE-node visibility probe and annotation passes. */
  readonly nodeOverlayPipelines: NodeOverlayPipelines;
  /** Library-owned world-space camera-pivot indicator. */
  readonly orbitPivot: OrbitPivotResources;
  /** Persistent world-origin triad with visible and weighted-ghost variants. */
  readonly originTriad: OriginTriadResources | undefined;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  readonly overlayDepth: OverlayDepthResources;
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
  originTriadEnabled = true,
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
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
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
  const overlayDepth = await createOverlayDepthResources(device, depthFormat, validation);
  const orientationGlyphs = await createOrientationGlyphPipelines({
    device,
    cameraLayout,
    format,
    depthFormat,
    ...(validation === undefined ? {} : { validation }),
  });
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
  const originTriadPipeline = originTriadEnabled
    ? await createOriginTriadPipeline({
        device,
        cameraLayout,
        format,
        depthFormat,
        validation,
      })
    : undefined;
  let background: BackgroundResources | undefined;
  let cameraBuffer: GPUBuffer | undefined;
  let deformationBuffer: GPUBuffer | undefined;
  let sectionPlaneBuffer: GPUBuffer | undefined;
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
    sectionPlaneBuffer = device.createBuffer({
      size: SECTION_PLANE_UNIFORM_SIZE,
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
        { binding: 2, resource: { buffer: sectionPlaneBuffer } },
      ],
    });
    if (originTriadPipeline !== undefined) {
      originTriad = createOriginTriadResources({
        device,
        pipeline: originTriadPipeline,
        frameBindGroup,
      });
    }
    return {
      cameraBuffer,
      deformationBuffer,
      sectionPlaneBuffer,
      frameBindGroup,
      instanceLayout,
      pipelineLayout: layout,
      overlayDepth,
      pipelines: pipelineResources.pipelines,
      orientationGlyphs,
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
    sectionPlaneBuffer?.destroy();
    throw error;
  }
}

export function destroyRenderResources(resources: RenderResources): void {
  resources.cameraBuffer.destroy();
  resources.deformationBuffer.destroy();
  resources.sectionPlaneBuffer.destroy();
  resources.orbitPivot.buffer.destroy();
  resources.originTriad?.buffer.destroy();
  destroyBackgroundResources(resources.background);
}

/** Ensures resolved overlays sample the current multisampled depth target. */
export function ensureOverlayDepthBindGroup(
  draw: ColorTargetOwner,
  resources: RenderResources,
): GPUBindGroup {
  if (draw.targets.overlayDepthBindGroup !== undefined) {
    return draw.targets.overlayDepthBindGroup;
  }
  if (draw.targets.depthTexture === undefined) {
    throw new Error("Visible depth target is not initialized");
  }
  draw.targets.overlayDepthBindGroup = createOverlayDepthBindGroup(
    draw.device,
    resources.overlayDepth.layout,
    draw.targets.depthTexture,
  );
  return draw.targets.overlayDepthBindGroup;
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
