import { colorFragmentShader, instanceVertexShader, pickFragmentShader } from "./gpu-shaders";
import { PICK_TEXTURE_FORMAT } from "./pick-format";
import { vertexLayout } from "./gpu-support";

/** WebGPU pipelines plus the layouts, camera buffer, and bind groups they share. */
export interface RenderResources {
  readonly cameraBuffer: GPUBuffer;
  readonly cameraBindGroup: GPUBindGroup;
  readonly colorPipeline: GPURenderPipeline;
  readonly pickPipeline: GPURenderPipeline;
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
  return { cameraBuffer, cameraBindGroup, colorPipeline, pickPipeline, instanceLayout };
}

/** Releases the buffer owned by the render resources (pipelines need none). */
export function destroyRenderResources(resources: RenderResources): void {
  resources.cameraBuffer.destroy();
}
