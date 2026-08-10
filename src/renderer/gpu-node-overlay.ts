import { cameraStruct, pointVertexShader } from "./gpu-shaders";
import type { DrawResources } from "./gpu-draw";
import { vertexLayout } from "./gpu-support";

export interface NodeOverlayPipelines {
  readonly visible: GPURenderPipeline;
  readonly depthLayout: GPUBindGroupLayout;
  readonly depthSampler: GPUSampler;
}

/** Creates the depth-tested, overlap-safe FE-node annotation pass. */
export function createNodeOverlayPipelines(
  device: GPUDevice,
  cameraLayout: GPUBindGroupLayout,
  instanceLayout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): NodeOverlayPipelines {
  const depthLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } },
    ],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [cameraLayout, instanceLayout, depthLayout],
  });
  return {
    visible: createNodePipeline(device, layout, format, depthFormat),
    depthLayout,
    depthSampler: device.createSampler({ compare: "less-equal" }),
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
      targets: [{ format, writeMask: 0xf, blend: blendState }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: "always",
      stencilFront: { compare: "equal", passOp: "increment-clamp" },
      stencilBack: { compare: "equal", passOp: "increment-clamp" },
      stencilReadMask: 1,
      stencilWriteMask: 1,
    },
  });
}

export const nodeOverlayFragmentShader = /* wgsl */ `
${cameraStruct}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(2) @binding(0) var sceneDepth: texture_depth_2d;
@group(2) @binding(1) var sceneDepthSampler: sampler_comparison;

@fragment
fn nodeOverlayFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0) { discard; }
  let centerPixel = fragmentPosition.xy - local * camera.pointSize * 0.25;
  let centerUv = centerPixel / camera.viewport;
  let oneDepthUnit = 1.0 / 16777215.0;
  let visible = textureSampleCompareLevel(
    sceneDepth,
    sceneDepthSampler,
    centerUv,
    fragmentPosition.z - oneDepthUnit,
  );
  if (visible == 0.0) { discard; }
  return vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
}
`;

/** Begins the color-loaded pass that reads, but never rewrites, scene depth. */
export function beginNodeOverlayPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [{ view: colorView, loadOp: "load", storeOp: "store" }],
    depthStencilAttachment: {
      view: depthView,
      depthReadOnly: true,
      stencilClearValue: 0,
      stencilLoadOp: "clear",
      stencilStoreOp: "discard",
    },
  });
}

/** Binds the scene depth aspect for center-based node visibility sampling. */
export function bindNodeOverlayDepth(
  pass: GPURenderPassEncoder,
  device: GPUDevice,
  pipelines: NodeOverlayPipelines,
  draw: DrawResources,
  depthTexture: GPUTexture,
): void {
  draw.nodeDepthBindGroup ??= device.createBindGroup({
    layout: pipelines.depthLayout,
    entries: [
      { binding: 0, resource: depthTexture.createView({ aspect: "depth-only" }) },
      { binding: 1, resource: pipelines.depthSampler },
    ],
  });
  pass.setBindGroup(2, draw.nodeDepthBindGroup);
}

const blendState: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};
