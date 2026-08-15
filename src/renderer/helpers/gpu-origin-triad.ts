import { projectPoint, type Camera } from "../../camera/camera";
import type { Bounds } from "../../geometry/part";
import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_ACCUMULATION_BLEND_STATE,
  TRANSPARENCY_REVEALAGE_FORMAT,
  TRANSPARENCY_REVEALAGE_BLEND_STATE,
} from "../core/gpu-transparency";
import { COLOR_SAMPLE_COUNT } from "../resources/gpu-support";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../core/gpu-validation";
import { originTriadShader } from "./gpu-origin-triad-shader";

/** GPU resources for the persistent world-origin presentation triad. */
export interface OriginTriadResources {
  readonly buffer: GPUBuffer;
  readonly frameBindGroup: GPUBindGroup;
  readonly bindGroup: GPUBindGroup;
  readonly visiblePipeline: GPURenderPipeline;
  readonly hiddenPipeline: GPURenderPipeline;
}

/** Internal world-space dimensions shared by the visible and hidden variants. */
export interface OriginTriadDimensions {
  readonly scale: number;
  readonly shaftRadius: number;
  readonly arrowLength: number;
  readonly arrowWidth: number;
  readonly hubRadius: number;
}

interface OriginTriadPipelineOptions {
  readonly device: GPUDevice;
  readonly cameraLayout: GPUBindGroupLayout;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly validation: GpuValidationOptions | undefined;
}

interface OriginTriadPipeline {
  readonly originLayout: GPUBindGroupLayout;
  readonly visiblePipeline: GPURenderPipeline;
  readonly hiddenPipeline: GPURenderPipeline;
}

interface OriginTriadResourceOptions {
  readonly device: GPUDevice;
  readonly pipeline: OriginTriadPipeline;
  readonly frameBindGroup: GPUBindGroup;
}

const ORIGIN_TRIAD_MAX_PIXELS = 56;

/** Resolves the world-space dimensions used by both triad variants. */
export function originTriadDimensions(scale: number): OriginTriadDimensions {
  const resolved = Math.max(Number.isFinite(scale) ? scale : 0, 1e-6);
  return {
    scale: resolved,
    shaftRadius: resolved * 0.025,
    arrowLength: resolved * 0.22,
    arrowWidth: resolved * 0.12,
    hubRadius: resolved * 0.06,
  };
}

/** Returns one deterministic nominal world scale from complete placed bounds. */
export function originTriadNominalScale(bounds: Bounds): number {
  const diagonal = Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
  return Number.isFinite(diagonal) && diagonal > 0 ? diagonal * 0.12 : 1e-6;
}

/** Resolves a stable world scale with a conservative projected CSS-pixel cap. */
export function originTriadScale(camera: Camera, nominalScale = 1): number {
  const nominal = Number.isFinite(nominalScale) && nominalScale > 0 ? nominalScale : 1e-6;
  const origin = projectPoint(camera, [0, 0, 0]);
  if (origin === undefined) return nominal;
  if (axisPixels(camera, origin, nominal) <= ORIGIN_TRIAD_MAX_PIXELS) return nominal;

  let low = 0;
  let high = nominal;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2;
    if (axisPixels(camera, origin, middle) <= ORIGIN_TRIAD_MAX_PIXELS) low = middle;
    else high = middle;
  }
  return Math.max(low, 1e-6);
}

function axisPixels(
  camera: Camera,
  origin: readonly [number, number, number],
  scale: number,
): number {
  let maximum = 0;
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const) {
    const endpoint = projectPoint(camera, [axis[0] * scale, axis[1] * scale, axis[2] * scale]);
    if (endpoint === undefined) return Number.POSITIVE_INFINITY;
    maximum = Math.max(maximum, Math.hypot(endpoint[0] - origin[0], endpoint[1] - origin[1]));
  }
  return maximum;
}

/** Creates visible and weighted-ghost pipelines over one shared shader and layout. */
export async function createOriginTriadPipeline(
  options: OriginTriadPipelineOptions,
): Promise<OriginTriadPipeline> {
  const originLayout = options.device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
  });
  const module = await createValidatedShaderModule(
    options.device,
    "world-origin triad",
    originTriadShader,
    options.validation,
  );
  const layout = options.device.createPipelineLayout({
    bindGroupLayouts: [options.cameraLayout, originLayout],
  });
  const visiblePipeline = await createValidatedRenderPipeline(
    options.device,
    "world-origin triad visible",
    triadPipelineDescriptor({
      layout,
      module,
      depthFormat: options.depthFormat,
      entryPoint: "visibleFragmentMain",
      depthCompare: "less-equal",
      depthWriteEnabled: false,
      stencilCompare: "always",
      stencilPassOp: "replace",
      stencilReadMask: 1,
      stencilWriteMask: 1,
      targets: [{ format: options.format }],
    }),
  );
  const hiddenPipeline = await createValidatedRenderPipeline(
    options.device,
    "world-origin triad hidden",
    triadPipelineDescriptor({
      layout,
      module,
      depthFormat: options.depthFormat,
      entryPoint: "hiddenFragmentMain",
      depthCompare: "greater",
      depthWriteEnabled: false,
      stencilCompare: "not-equal",
      stencilPassOp: "keep",
      stencilReadMask: 1,
      stencilWriteMask: 0,
      targets: [
        {
          format: TRANSPARENCY_ACCUMULATION_FORMAT,
          blend: TRANSPARENCY_ACCUMULATION_BLEND_STATE,
        },
        { format: TRANSPARENCY_REVEALAGE_FORMAT, blend: TRANSPARENCY_REVEALAGE_BLEND_STATE },
      ],
    }),
  );
  return { originLayout, visiblePipeline, hiddenPipeline };
}

/** Allocates the shared triad uniform and bind group. */
export function createOriginTriadResources(
  options: OriginTriadResourceOptions,
): OriginTriadResources {
  const buffer = options.device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    return {
      buffer,
      frameBindGroup: options.frameBindGroup,
      bindGroup: options.device.createBindGroup({
        layout: options.pipeline.originLayout,
        entries: [{ binding: 0, resource: { buffer } }],
      }),
      visiblePipeline: options.pipeline.visiblePipeline,
      hiddenPipeline: options.pipeline.hiddenPipeline,
    };
  } catch (error) {
    buffer.destroy();
    throw error;
  }
}

/** Writes one scale uniform shared by the visible and hidden draws. */
export function writeOriginTriad(
  device: GPUDevice,
  resources: OriginTriadResources,
  scale: number,
): void {
  const dimensions = originTriadDimensions(scale);
  device.queue.writeBuffer(
    resources.buffer,
    0,
    new Float32Array([
      dimensions.scale,
      dimensions.shaftRadius,
      dimensions.arrowLength,
      dimensions.arrowWidth,
      dimensions.hubRadius,
      0,
      0,
      0,
    ]),
  );
}

/** Draws one origin-triad depth variant without entering any pick pass. */
export function drawOriginTriad(
  pass: GPURenderPassEncoder,
  resources: OriginTriadResources,
  variant: "visible" | "hidden",
): void {
  pass.setPipeline(variant === "visible" ? resources.visiblePipeline : resources.hiddenPipeline);
  pass.setStencilReference(1);
  pass.setBindGroup(0, resources.frameBindGroup);
  pass.setBindGroup(1, resources.bindGroup);
  pass.draw(45);
}

function triadPipelineDescriptor(options: {
  readonly layout: GPUPipelineLayout;
  readonly module: GPUShaderModule;
  readonly depthFormat: GPUTextureFormat;
  readonly entryPoint: string;
  readonly depthCompare: GPUCompareFunction;
  readonly depthWriteEnabled: boolean;
  readonly stencilCompare: GPUCompareFunction;
  readonly stencilPassOp: GPUStencilOperation;
  readonly stencilReadMask: number;
  readonly stencilWriteMask: number;
  readonly targets: GPUColorTargetState[];
}): GPURenderPipelineDescriptor {
  return {
    layout: options.layout,
    vertex: { module: options.module, entryPoint: "vertexMain" },
    fragment: { module: options.module, entryPoint: options.entryPoint, targets: options.targets },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: options.depthFormat,
      depthWriteEnabled: options.depthWriteEnabled,
      depthCompare: options.depthCompare,
      stencilFront: {
        compare: options.stencilCompare,
        passOp: options.stencilPassOp,
      },
      stencilBack: {
        compare: options.stencilCompare,
        passOp: options.stencilPassOp,
      },
      stencilReadMask: options.stencilReadMask,
      stencilWriteMask: options.stencilWriteMask,
    },
    multisample: { count: COLOR_SAMPLE_COUNT },
  };
}
