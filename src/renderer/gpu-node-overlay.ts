import { pointVertexShader } from "./gpu-instanced-shaders";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "./gpu-support";

export interface NodeOverlayPipelines {
  readonly visible: GPURenderPipeline;
}

/** Creates the depth-tested FE-node annotation pass. */
export function createNodeOverlayPipelines(
  device: GPUDevice,
  cameraLayout: GPUBindGroupLayout,
  instanceLayout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): NodeOverlayPipelines {
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [cameraLayout, instanceLayout],
  });
  return {
    visible: createNodePipeline(device, layout, format, depthFormat),
  };
}

function createNodePipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): GPURenderPipeline {
  return device.createRenderPipeline({
    layout,
    vertex: {
      module: device.createShaderModule({ code: pointVertexShader }),
      entryPoint: "nodeOverlayVertexMain",
      buffers: [vertexLayout],
    },
    fragment: {
      module: device.createShaderModule({ code: nodeOverlayFragmentShader }),
      entryPoint: "nodeOverlayFragmentMain",
      targets: [{ format, writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: COLOR_SAMPLE_COUNT, alphaToCoverageEnabled: true },
  });
}

export const nodeOverlayFragmentShader = /* wgsl */ `
@fragment
fn nodeOverlayFragmentMain(
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0) { discard; }
  return vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
}
`;
