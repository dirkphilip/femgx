import { colorFragmentShader, pointVertexShader } from "./gpu-shaders";
import { vertexLayout } from "./gpu-support";

export interface NodeOverlayPipelines {
  readonly visible: GPURenderPipeline;
}

interface NodePipelineOptions {
  readonly fragmentCode: string;
  readonly writeMask: GPUColorWriteFlags;
  readonly stencilCompare: GPUCompareFunction;
  readonly stencilPassOp: GPUStencilOperation;
}

/** Creates the depth-tested, overlap-safe FE-node annotation pass. */
export function createNodeOverlayPipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): NodeOverlayPipelines {
  return {
    visible: createNodePipeline(device, layout, format, depthFormat, {
      fragmentCode: colorFragmentShader,
      writeMask: 0xf,
      stencilCompare: "equal",
      stencilPassOp: "increment-clamp",
    }),
  };
}

function createNodePipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  options: NodePipelineOptions,
): GPURenderPipeline {
  return device.createRenderPipeline({
    layout,
    vertex: {
      module: device.createShaderModule({ code: pointVertexShader }),
      entryPoint: "nodeOverlayVertexMain",
      buffers: [vertexLayout],
    },
    fragment: {
      module: device.createShaderModule({ code: options.fragmentCode }),
      entryPoint: "fragmentMain",
      targets: [{ format, writeMask: options.writeMask, blend: blendState }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
      stencilFront: { compare: options.stencilCompare, passOp: options.stencilPassOp },
      stencilBack: { compare: options.stencilCompare, passOp: options.stencilPassOp },
      stencilReadMask: 1,
      stencilWriteMask: 1,
    },
  });
}

const blendState: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};
