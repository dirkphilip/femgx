import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

/** Pipeline state for resolving multisampled opaque depth before overlays. */
export interface OverlayDepthResources {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
}

const overlayDepthShader = /* wgsl */ `
@group(0) @binding(0) var sourceDepth: texture_depth_multisampled_2d;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @builtin(frag_depth) f32 {
  let pixel = vec2<i32>(fragmentPosition.xy);
  var furthestDepth = textureLoad(sourceDepth, pixel, 0);
  furthestDepth = max(furthestDepth, textureLoad(sourceDepth, pixel, 1));
  furthestDepth = max(furthestDepth, textureLoad(sourceDepth, pixel, 2));
  return max(furthestDepth, textureLoad(sourceDepth, pixel, 3));
}
`;

/** Creates the bounded fullscreen depth resolve used only by active overlays. */
export async function createOverlayDepthResources(
  device: GPUDevice,
  depthFormat: GPUTextureFormat,
  validation: GpuValidationOptions | undefined,
): Promise<OverlayDepthResources> {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "depth", viewDimension: "2d", multisampled: true },
      },
    ],
  });
  const module = await createValidatedShaderModule(
    device,
    "presentation depth resolve",
    overlayDepthShader,
    validation,
  );
  const pipeline = await createValidatedRenderPipeline(device, "presentation depth resolve", {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: "vertexMain" },
    fragment: { module, entryPoint: "fragmentMain", targets: [] },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: true,
      depthCompare: "always",
    },
  });
  return { layout, pipeline };
}

/** Binds the current multisampled source depth for one resolve pass. */
export function createOverlayDepthBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  depthTexture: GPUTexture,
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: [
      {
        binding: 0,
        resource: depthTexture.createView({ aspect: "depth-only" }),
      },
    ],
  });
}
