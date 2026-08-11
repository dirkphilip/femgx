/* eslint-disable jsdoc/require-jsdoc, max-lines-per-function */
import { colorFragmentShader, edgeFragmentShader, edgeVertexShader } from "./gpu-shaders";
import { instanceVertexShader, lineVertexShader, pointVertexShader } from "./gpu-instanced-shaders";
import {
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
} from "./gpu-node-pick";
import { PICK_TEXTURE_FORMAT } from "./pick-format";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "./gpu-support";
import { DEFORMATION_UNIFORM_SIZE } from "./gpu-deform";
import type { DrawResources } from "./gpu-draw";
import { createNodeOverlayPipelines } from "./gpu-node-overlay";
import type { NodeOverlayPipelines } from "./gpu-node-overlay";
import { createOrbitPivotResources, type OrbitPivotResources } from "./gpu-orbit-pivot";

export { COLOR_SAMPLE_COUNT } from "./gpu-support";

export interface DrawPipelines {
  readonly trianglesColor: GPURenderPipeline;
  readonly trianglesPick: GPURenderPipeline;
  readonly linesColor: GPURenderPipeline;
  readonly linesPick: GPURenderPipeline;
  readonly pointsColor: GPURenderPipeline;
  readonly pointsPick: GPURenderPipeline;
}

export interface RenderResources {
  readonly cameraBuffer: GPUBuffer;
  readonly deformationBuffer: GPUBuffer;
  readonly frameBindGroup: GPUBindGroup;
  readonly pipelines: DrawPipelines;
  readonly edgePipeline: GPURenderPipeline;
  readonly edgeAlwaysPipeline: GPURenderPipeline;
  /** Final FE-node visibility probe and annotation passes. */
  readonly nodeOverlayPipelines: NodeOverlayPipelines;
  /** Library-owned world-space camera-pivot indicator. */
  readonly orbitPivot: OrbitPivotResources;
  readonly instanceLayout: GPUBindGroupLayout;
}

export const CAMERA_UNIFORM_SIZE = 96;

interface PipelineSpec {
  readonly depthFormat: GPUTextureFormat;
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly fragmentModule: GPUShaderModule;
  readonly passFormats: readonly GPUTextureFormat[];
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
  readonly sampleCount: number;
}

export function createRenderResources(
  device: GPUDevice,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): RenderResources {
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
      { binding: 8, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 9, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
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
  const cameraBuffer = device.createBuffer({
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const deformationBuffer = device.createBuffer({
    size: DEFORMATION_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const frameBindGroup = device.createBindGroup({
    layout: cameraLayout,
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: deformationBuffer } },
    ],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [cameraLayout, instanceLayout],
  });
  const pipelines = buildPipelines(device, layout, format, depthFormat);
  const edgePipeline = createEdgePipeline(device, layout, format, depthFormat, "less-equal");
  const edgeAlwaysPipeline = createEdgePipeline(device, layout, format, depthFormat, "always");
  const nodeOverlayPipelines = createNodeOverlayPipelines(
    device,
    cameraLayout,
    instanceLayout,
    format,
    depthFormat,
  );
  const orbitPivot = createOrbitPivotResources(
    device,
    format,
    depthFormat,
    cameraBuffer,
    deformationBuffer,
  );
  return {
    cameraBuffer,
    deformationBuffer,
    frameBindGroup,
    instanceLayout,
    pipelines,
    edgePipeline,
    edgeAlwaysPipeline,
    nodeOverlayPipelines,
    orbitPivot,
  };
}

const PICK_FORMATS = [
  PICK_TEXTURE_FORMAT,
  PICK_TEXTURE_FORMAT,
  PICK_TEXTURE_FORMAT,
  PICK_TEXTURE_FORMAT,
] as const;

/** Module-level pieces shared by the pipelines. */
interface PipelineShaders {
  readonly triangleVertex: GPUShaderModule;
  readonly lineVertex: GPUShaderModule;
  readonly pointVertex: GPUShaderModule;
  readonly lineNodeVertex: GPUShaderModule;
  readonly pointNodeVertex: GPUShaderModule;
  readonly colorFragment: GPUShaderModule;
  readonly nodePickVertex: GPUShaderModule;
  readonly nodePickFragment: GPUShaderModule;
}

/** Primitive-level pipeline parameters (shared across color and pick passes). */
interface PrimitiveSpec {
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
}

interface PipelineVariants {
  readonly triangles: PrimitiveSpec;
  readonly lines: PrimitiveSpec;
  readonly points: PrimitiveSpec;
}

function createPipelineShaders(device: GPUDevice): PipelineShaders {
  return {
    triangleVertex: device.createShaderModule({ code: instanceVertexShader }),
    lineVertex: device.createShaderModule({ code: lineVertexShader }),
    pointVertex: device.createShaderModule({ code: pointVertexShader }),
    lineNodeVertex: device.createShaderModule({ code: lineNodePickVertexShader }),
    pointNodeVertex: device.createShaderModule({ code: pointNodePickVertexShader }),
    colorFragment: device.createShaderModule({ code: colorFragmentShader }),
    nodePickVertex: device.createShaderModule({ code: nodePickVertexShader }),
    nodePickFragment: device.createShaderModule({ code: nodePickFragmentShader }),
  };
}

function pipelineVariants(shaders: PipelineShaders): PipelineVariants {
  return {
    triangles: {
      vertexModule: shaders.triangleVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list",
      // FE shells and surface meshes are valid from either side; culling their
      // reverse winding makes an ordinary 180° orbit look like missing geometry.
      cullMode: "none",
    },
    lines: {
      vertexModule: shaders.lineVertex,
      vertexEntry: "vertexMain",
      primitive: "line-list",
      cullMode: "none",
    },
    points: {
      vertexModule: shaders.pointVertex,
      vertexEntry: "pointVertexMain",
      primitive: "triangle-list",
      cullMode: "none",
    },
  };
}

function buildPipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): DrawPipelines {
  const shaders = createPipelineShaders(device);
  const variants = pipelineVariants(shaders);
  const make = (
    spec: PrimitiveSpec,
    fragmentModule: GPUShaderModule,
    passFormats: readonly GPUTextureFormat[],
    sampleCount: number,
  ): GPURenderPipeline =>
    createPipeline(device, layout, {
      ...spec,
      passFormats,
      depthFormat,
      fragmentModule,
      sampleCount,
    });
  return {
    trianglesColor: make(variants.triangles, shaders.colorFragment, [format], COLOR_SAMPLE_COUNT),
    trianglesPick: make(
      { ...variants.triangles, vertexModule: shaders.nodePickVertex },
      shaders.nodePickFragment,
      PICK_FORMATS,
      1,
    ),
    linesColor: make(variants.lines, shaders.colorFragment, [format], COLOR_SAMPLE_COUNT),
    linesPick: make(
      { ...variants.lines, vertexModule: shaders.lineNodeVertex },
      shaders.nodePickFragment,
      PICK_FORMATS,
      1,
    ),
    pointsColor: make(variants.points, shaders.colorFragment, [format], COLOR_SAMPLE_COUNT),
    pointsPick: make(
      { ...variants.points, vertexModule: shaders.pointNodeVertex },
      shaders.nodePickFragment,
      PICK_FORMATS,
      1,
    ),
  };
}

function createPipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  spec: PipelineSpec,
): GPURenderPipeline {
  return device.createRenderPipeline({
    layout,
    vertex: {
      module: spec.vertexModule,
      entryPoint: spec.vertexEntry,
      buffers: [vertexLayout],
    },
    fragment: {
      module: spec.fragmentModule,
      entryPoint: "fragmentMain",
      targets: spec.passFormats.map((passFormat) => ({ format: passFormat })),
    },
    primitive: { topology: spec.primitive, cullMode: spec.cullMode },
    depthStencil: {
      format: spec.depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
    },
    multisample: { count: spec.sampleCount },
  });
}

/** Creates a depth-tested or always-visible line overlay pipeline. */
function createEdgePipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  depthCompare: GPUCompareFunction,
): GPURenderPipeline {
  return device.createRenderPipeline({
    layout,
    vertex: {
      module: device.createShaderModule({ code: edgeVertexShader }),
      entryPoint: "vertexMain",
      buffers: [vertexLayout],
    },
    fragment: {
      module: device.createShaderModule({ code: edgeFragmentShader }),
      entryPoint: "fragmentMain",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "line-list", cullMode: "none" },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare },
    multisample: { count: COLOR_SAMPLE_COUNT },
  });
}

export function destroyRenderResources(resources: RenderResources): void {
  resources.cameraBuffer.destroy();
  resources.deformationBuffer.destroy();
  resources.orbitPivot.buffer.destroy();
}

/** Allocates or reuses the multisampled color + depth targets for a visible frame. */
export function ensureColorTargets(
  draw: DrawResources,
  width: number,
  height: number,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): { readonly color: GPUTexture; readonly depth: GPUTexture } {
  if (
    draw.msaaColorTexture !== undefined &&
    draw.depthTexture !== undefined &&
    draw.depthWidth === width &&
    draw.depthHeight === height
  ) {
    return { color: draw.msaaColorTexture, depth: draw.depthTexture };
  }
  draw.msaaColorTexture?.destroy();
  draw.depthTexture?.destroy();
  draw.msaaColorTexture = draw.device.createTexture({
    size: [width, height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: colorFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  draw.depthTexture = draw.device.createTexture({
    size: [width, height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  draw.depthWidth = width;
  draw.depthHeight = height;
  return { color: draw.msaaColorTexture, depth: draw.depthTexture };
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
