import {
  colorFragmentShader,
  edgeVertexShader,
  instanceVertexShader,
  pickFragmentShader,
  pointVertexShader,
} from "./gpu-shaders";
import { PICK_TEXTURE_FORMAT } from "./pick-format";
import { vertexLayout } from "./gpu-support";
import type { DrawResources } from "./gpu-draw";

/** The six render pipelines: color and pick variants for each primitive. */
export interface DrawPipelines {
  readonly trianglesColor: GPURenderPipeline;
  readonly trianglesPick: GPURenderPipeline;
  readonly linesColor: GPURenderPipeline;
  readonly linesPick: GPURenderPipeline;
  readonly pointsColor: GPURenderPipeline;
  readonly pointsPick: GPURenderPipeline;
}

/** WebGPU pipelines plus the layouts, camera buffer, and bind groups they share. */
export interface RenderResources {
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly pipelines: DrawPipelines;
  /** Depth-tested line overlay that draws the mesh edges in the edge pass. */
  readonly edgePipeline: GPURenderPipeline;
  /** Line overlay with depth compare `always`, showing edges through surfaces. */
  readonly edgeAlwaysPipeline: GPURenderPipeline;
  readonly instanceLayout: GPUBindGroupLayout;
}

/** Bytes of the camera uniform (mat4 + viewport + pointSize + padding). */
export const CAMERA_UNIFORM_SIZE = 80;

interface PipelineSpec {
  readonly depthFormat: GPUTextureFormat;
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly fragmentModule: GPUShaderModule;
  readonly passFormats: readonly GPUTextureFormat[];
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
}

/**
 * Creates the shared bind group layouts, camera uniform buffer, and the color
 * and pick render pipelines for triangle, line, and point-sprite primitives,
 * plus the line-list overlay pipeline used in edge display mode.
 */
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
    ],
  });
  const cameraLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
  });
  const cameraBuffer = device.createBuffer({
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const cameraBindGroup = device.createBindGroup({
    layout: cameraLayout,
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [cameraLayout, instanceLayout],
  });
  return {
    cameraBuffer,
    cameraBindGroup,
    instanceLayout,
    pipelines: buildPipelines(device, layout, format, depthFormat),
    edgePipeline: createEdgePipeline(device, layout, format, depthFormat, "less-equal"),
    edgeAlwaysPipeline: createEdgePipeline(device, layout, format, depthFormat, "always"),
  };
}

/** Module-level pieces shared by the six pipelines. */
interface PipelineShaders {
  readonly triangleVertex: GPUShaderModule;
  readonly pointVertex: GPUShaderModule;
  readonly colorFragment: GPUShaderModule;
  readonly pickFragment: GPUShaderModule;
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
    pointVertex: device.createShaderModule({ code: pointVertexShader }),
    colorFragment: device.createShaderModule({ code: colorFragmentShader }),
    pickFragment: device.createShaderModule({ code: pickFragmentShader }),
  };
}

function pipelineVariants(shaders: PipelineShaders): PipelineVariants {
  return {
    triangles: {
      vertexModule: shaders.triangleVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list",
      cullMode: "back",
    },
    lines: {
      vertexModule: shaders.triangleVertex,
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
  ): GPURenderPipeline =>
    createPipeline(device, layout, {
      ...spec,
      passFormats,
      depthFormat,
      fragmentModule,
    });
  return {
    trianglesColor: make(variants.triangles, shaders.colorFragment, [format]),
    trianglesPick: make(variants.triangles, shaders.pickFragment, [
      PICK_TEXTURE_FORMAT,
      PICK_TEXTURE_FORMAT,
    ]),
    linesColor: make(variants.lines, shaders.colorFragment, [format]),
    linesPick: make(variants.lines, shaders.pickFragment, [
      PICK_TEXTURE_FORMAT,
      PICK_TEXTURE_FORMAT,
    ]),
    pointsColor: make(variants.points, shaders.colorFragment, [format]),
    pointsPick: make(variants.points, shaders.pickFragment, [
      PICK_TEXTURE_FORMAT,
      PICK_TEXTURE_FORMAT,
    ]),
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
  });
}

/**
 * Creates a line-list pipeline that overlays mesh edges on the color pass for
 * the parts whose style requests it. Depth writes stay off so the overlay never
 * hides the solid pass drawn underneath; the compare function selects whether
 * edges occluded by nearer geometry are culled (`less-equal`) or drawn through
 * everything (`always`).
 */
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
      module: device.createShaderModule({ code: colorFragmentShader }),
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "line-list", cullMode: "none" },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare },
  });
}

/** Configures the canvas context for a device and surface format. */
export function configureCanvasContext(
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat,
): void {
  context.configure({ device, format, alphaMode: "opaque" });
}

/** Releases the buffer owned by the render resources (pipelines need none). */
export function destroyRenderResources(resources: RenderResources): void {
  resources.cameraBuffer.destroy();
}

/** Creates a depth attachment sized to the given canvas dimensions. */
export function createDepthTexture(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
): GPUTexture {
  return device.createTexture({
    size: [width, height],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/** Returns the cached depth texture, recreating it only when the canvas size changes. */
export function ensureDepthTexture(
  draw: DrawResources,
  width: number,
  height: number,
  format: GPUTextureFormat,
): GPUTexture {
  if (draw.depthTexture !== undefined && draw.depthWidth === width && draw.depthHeight === height) {
    return draw.depthTexture;
  }
  draw.depthTexture?.destroy();
  const texture = createDepthTexture(draw.device, width, height, format);
  draw.depthTexture = texture;
  draw.depthWidth = width;
  draw.depthHeight = height;
  return texture;
}

/** Begins the visible color render pass with a cleared depth attachment. */
export function beginColorPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        clearValue: { r: 0.04, g: 0.06, b: 0.12, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
}
