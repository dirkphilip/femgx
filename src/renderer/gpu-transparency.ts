import {
  cameraStruct,
  deformationStruct,
  surfaceLightingFunction,
  frameBindings,
} from "./gpu-shaders";
import { COLOR_SAMPLE_COUNT } from "./gpu-support";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "./gpu-validation";

/** Render-target formats used by the weighted blended transparency path. */
export const TRANSPARENCY_ACCUMULATION_FORMAT = "rgba16float" as GPUTextureFormat;
export const TRANSPARENCY_REVEALAGE_FORMAT = "rgba8unorm" as GPUTextureFormat;

/** Blend states for additive color/weight and multiplicative revealage. */
export const TRANSPARENCY_BLEND_STATES: readonly GPUBlendState[] = [
  {
    color: { srcFactor: "one", dstFactor: "one" },
    alpha: { srcFactor: "one", dstFactor: "one" },
  },
  {
    color: { srcFactor: "zero", dstFactor: "one-minus-src" },
    alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
  },
];

/** A weighted transparency fragment output with one accumulation and one revealage target. */
export const transparencyOutput = /* wgsl */ `
struct TransparencyOutput {
  @location(0) accumulation: vec4<f32>,
  @location(1) revealage: vec4<f32>,
};

fn transparencyWeight(alpha: f32) -> f32 {
  return max(0.01, alpha * 8.0);
}

fn weightedTransparency(color: vec3<f32>, alpha: f32) -> TransparencyOutput {
  let weight = transparencyWeight(alpha);
  var output: TransparencyOutput;
  output.accumulation = vec4<f32>(color * alpha * weight, alpha * weight);
  output.revealage = vec4<f32>(alpha);
  return output;
}
`;

/** Transparent line and point fragment stage. */
export const transparencyFragmentShader = /* wgsl */ `
${transparencyOutput}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
) -> TransparencyOutput {
  if (dot(local, local) > 1.0 || color.a <= 0.0 || color.a >= 1.0) { discard; }
  return weightedTransparency(color.rgb + vec3<f32>(emissive), color.a);
}
`;

/** Transparent lit triangle fragment stage. */
export const triangleTransparencyFragmentShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}
${surfaceLightingFunction}
${transparencyOutput}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
) -> TransparencyOutput {
  if (dot(local, local) > 1.0 || color.a <= 0.0 || color.a >= 1.0) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    color.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  return weightedTransparency(litColor + vec3<f32>(emissive), color.a);
}
`;

/** Full-screen compositing shader for resolved opaque and weighted transparent targets. */
export const compositeShader = /* wgsl */ `
@group(0) @binding(0) var opaqueTexture: texture_2d<f32>;
@group(0) @binding(1) var accumulationTexture: texture_2d<f32>;
@group(0) @binding(2) var revealageTexture: texture_2d<f32>;

struct CompositeOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> CompositeOutput {
  var output: CompositeOutput;
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  output.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let coordinate = vec2<i32>(i32(position.x), i32(position.y));
  let opaque = textureLoad(opaqueTexture, coordinate, 0);
  let accumulation = textureLoad(accumulationTexture, coordinate, 0);
  let revealage = clamp(textureLoad(revealageTexture, coordinate, 0).r, 0.0, 1.0);
  let transparentAlpha = 1.0 - revealage;
  let transparentColor = select(
    vec3<f32>(0.0),
    accumulation.rgb / max(accumulation.a, 1e-5),
    accumulation.a > 1e-5,
  );
  return vec4<f32>(transparentColor * transparentAlpha + opaque.rgb * revealage, 1.0);
}
`;

export interface CompositeResources {
  readonly pipeline: GPURenderPipeline;
  readonly layout: GPUBindGroupLayout;
}

/** Creates the fullscreen pipeline used after weighted accumulation. */
export async function createCompositeResources(
  device: GPUDevice,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation?: GpuValidationOptions,
): Promise<CompositeResources> {
  const layout = device.createBindGroupLayout({
    entries: [0, 1, 2].map((binding) => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: "float",
        viewDimension: "2d",
      },
    })),
  });
  const module = await createValidatedShaderModule(
    device,
    "transparency composite",
    compositeShader,
    validation,
  );
  const pipeline = await createValidatedRenderPipeline(device, "transparency composite", {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: "vertexMain" },
    fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: "always" },
    multisample: { count: COLOR_SAMPLE_COUNT },
  });
  return { pipeline, layout };
}

/** Creates a bind group over the resolved opaque, accumulation, and revealage views. */
export function createCompositeBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  opaque: GPUTextureView,
  accumulation: GPUTextureView,
  revealage: GPUTextureView,
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: opaque },
      { binding: 1, resource: accumulation },
      { binding: 2, resource: revealage },
    ],
  });
}
