import {
  colorFragmentShader,
  edgeVertexShader,
  instanceVertexShader,
  pickFragmentShader,
} from "./gpu-shaders";
import { PICK_TEXTURE_FORMAT } from "./pick-format";
import { vertexLayout } from "./gpu-support";
import type { DrawResources } from "./gpu-draw";

/** WebGPU pipelines plus the layouts, camera buffer, and bind groups they share. */
export interface RenderResources {
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly colorPipeline: GPURenderPipeline;
  readonly pickPipeline: GPURenderPipeline;
  /** Line-list overlay that draws the mesh edges in edge display mode. */
  readonly edgePipeline: GPURenderPipeline;
  readonly instanceLayout: GPUBindGroupLayout;
}

/**
 * Creates the shared bind group layouts, camera uniform buffer, and the color
 * and pick render pipelines used by every frame.
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
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const cameraBindGroup = device.createBindGroup({
    layout: cameraLayout,
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [cameraLayout, instanceLayout],
  });
  const vertexModule = device.createShaderModule({ code: instanceVertexShader });
  const colorPipeline = device.createRenderPipeline({
    layout,
    vertex: { module: vertexModule, entryPoint: "vertexMain", buffers: [vertexLayout] },
    fragment: {
      module: device.createShaderModule({ code: colorFragmentShader }),
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "less" },
  });
  const pickPipeline = device.createRenderPipeline({
    layout,
    vertex: { module: vertexModule, entryPoint: "vertexMain", buffers: [vertexLayout] },
    fragment: {
      module: device.createShaderModule({ code: pickFragmentShader }),
      entryPoint: "fragmentMain",
      targets: [{ format: PICK_TEXTURE_FORMAT }, { format: PICK_TEXTURE_FORMAT }],
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "less" },
  });
  const edgePipeline = createEdgePipeline(device, layout, format, depthFormat);
  return {
    cameraBuffer,
    cameraBindGroup,
    colorPipeline,
    pickPipeline,
    edgePipeline,
    instanceLayout,
  };
}

/**
 * Creates the line-list pipeline that overlays mesh edges on the color pass in
 * edge display mode. Depth writes stay off so the overlay never hides the
 * solid pass drawn underneath.
 */
function createEdgePipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
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
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: "less-equal" },
  });
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
