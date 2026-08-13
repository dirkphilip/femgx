import { boundsCorners, isFiniteBounds, type Bounds, type Part } from "../geometry/part";
import type { Mat4 } from "../math/mat4";
import { transformPoint } from "../math/mat4";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_ACCUMULATION_BLEND_STATE,
  TRANSPARENCY_REVEALAGE_FORMAT,
  TRANSPARENCY_REVEALAGE_BLEND_STATE,
} from "./gpu-transparency";
import { COLOR_SAMPLE_COUNT } from "./gpu-support";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "./gpu-validation";
import { originTriadShader } from "./gpu-origin-triad-shader";

/** GPU resources for the persistent world-origin presentation triad. */
export interface OriginTriadResources {
  readonly buffer: GPUBuffer;
  readonly frameBindGroup: GPUBindGroup;
  readonly bindGroup: GPUBindGroup;
  readonly visiblePipeline: GPURenderPipeline;
  readonly hiddenPipeline: GPURenderPipeline;
}

/** Internal dimensions derived from one complete-scene world-space scale. */
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

/** Resolves the stable world-space dimensions used by both triad variants. */
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

/** Returns the complete placed-scene scale, including currently hidden occurrences. */
export function originTriadScale(
  runtime: PackedSceneRuntime,
  parts: ReadonlyMap<number, Part>,
): number {
  const bounds = emptyBounds();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : parts.get(partId);
    if (part === undefined || transform === undefined || !isFiniteBounds(part.bounds)) continue;
    includeTransformed(bounds, part.bounds, transform);
  }
  if (!isFiniteBounds(bounds)) return 0.12;
  const extent = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
  const diagonal = Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
  const span = Math.max(extent, diagonal);
  return span > 0 ? span * 0.12 : 0.12;
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

function emptyBounds(): MutableBounds {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
}

function includeTransformed(bounds: MutableBounds, partBounds: Bounds, transform: Mat4): void {
  for (const corner of boundsCorners(partBounds)) {
    const point = transformPoint(transform, corner[0], corner[1], corner[2]);
    bounds.minX = Math.min(bounds.minX, point[0]);
    bounds.minY = Math.min(bounds.minY, point[1]);
    bounds.minZ = Math.min(bounds.minZ, point[2]);
    bounds.maxX = Math.max(bounds.maxX, point[0]);
    bounds.maxY = Math.max(bounds.maxY, point[1]);
    bounds.maxZ = Math.max(bounds.maxZ, point[2]);
  }
}

interface MutableBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
