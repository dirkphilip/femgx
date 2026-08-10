import { cameraStruct, pointVertexShader } from "./gpu-shaders";
import type { DrawResources } from "./gpu-draw";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "./gpu-support";

export interface NodeOverlayPipelines {
  readonly visible: GPURenderPipeline;
  readonly depthLayout: GPUBindGroupLayout;
}

/** Creates the depth-tested FE-node annotation pass. */
export function createNodeOverlayPipelines(
  device: GPUDevice,
  cameraLayout: GPUBindGroupLayout,
  instanceLayout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): NodeOverlayPipelines {
  const depthLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "depth", multisampled: true },
      },
    ],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [cameraLayout, instanceLayout, depthLayout],
  });
  return {
    visible: createNodePipeline(device, layout, format, depthFormat),
    depthLayout,
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
    },
    multisample: { count: COLOR_SAMPLE_COUNT },
  });
}

export const nodeOverlayFragmentShader = /* wgsl */ `
${cameraStruct}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(2) @binding(0) var sceneDepth: texture_depth_multisampled_2d;

fn eyeDepth(z: f32) -> f32 {
  if (camera.ortho > 0.5) {
    return camera.nearPlane + z * (camera.farPlane - camera.nearPlane);
  }
  return (camera.nearPlane * camera.farPlane) /
    max(camera.farPlane - z * (camera.farPlane - camera.nearPlane), 1e-8);
}

fn sampleOccludes(sceneZ: f32, nodeEye: f32) -> bool {
  return eyeDepth(sceneZ) + camera.depthSlack < nodeEye;
}

@fragment
fn nodeOverlayFragmentMain(
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(6) @interpolate(flat) centerPixel: vec2<f32>,
  @location(7) @interpolate(flat) nodeDepth: f32,
) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0) { discard; }
  // Unanimous MSAA occlusion: hide only when every subsample is clearly nearer.
  // min()-based tests blinked front glyphs when any coplanar/silhouette sample
  // was slightly nearer than the vertex (see node-overlay-visibility.ts).
  let dims = vec2<i32>(textureDimensions(sceneDepth));
  let center = clamp(vec2<i32>(floor(centerPixel)), vec2<i32>(0), dims - 1);
  let nodeEye = eyeDepth(nodeDepth);
  if (
    sampleOccludes(textureLoad(sceneDepth, center, 0), nodeEye) &&
    sampleOccludes(textureLoad(sceneDepth, center, 1), nodeEye) &&
    sampleOccludes(textureLoad(sceneDepth, center, 2), nodeEye) &&
    sampleOccludes(textureLoad(sceneDepth, center, 3), nodeEye)
  ) {
    discard;
  }
  return vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
}
`;

/**
 * Begins the color-loaded overlay pass that reads, but never rewrites, scene
 * depth, and resolves the multisampled color target to the canvas.
 */
export function beginNodeOverlayPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  resolveTarget: GPUTextureView,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        resolveTarget,
        loadOp: "load",
        storeOp: "discard",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthReadOnly: true,
      stencilReadOnly: true,
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
    entries: [{ binding: 0, resource: depthTexture.createView({ aspect: "depth-only" }) }],
  });
  pass.setBindGroup(2, draw.nodeDepthBindGroup);
}

const blendState: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};
