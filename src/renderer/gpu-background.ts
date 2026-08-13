import { cameraStruct } from "./gpu-shaders";
import { COLOR_SAMPLE_COUNT } from "./gpu-support";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "./gpu-validation";
import type { ViewportBackground } from "./types";

type Rgba = readonly [number, number, number, number];
type BackgroundColorSet = { readonly top: Rgba; readonly bottom: Rgba };

const BACKGROUND_COLORS: Readonly<Record<ViewportBackground, BackgroundColorSet>> = {
  studio: {
    top: [0.93, 0.95, 0.97, 1],
    bottom: [0.74, 0.78, 0.84, 1],
  },
  white: {
    top: [1, 1, 1, 1],
    bottom: [1, 1, 1, 1],
  },
  dark: {
    top: [0.12, 0.15, 0.2, 1],
    bottom: [0.07, 0.09, 0.13, 1],
  },
};

/** Returns the internal color endpoints for a built-in viewport background. */
export function resolveBackgroundColors(background: ViewportBackground): {
  readonly top: Rgba;
  readonly bottom: Rgba;
} {
  const colors = (BACKGROUND_COLORS as Readonly<Record<string, BackgroundColorSet>>)[background];
  if (colors === undefined) {
    throw new Error(`Unsupported viewport background: ${background}`);
  }
  return colors;
}

/** GPU resources for the single fullscreen background draw. */
export interface BackgroundResources {
  readonly pipeline: GPURenderPipeline;
  readonly bindGroup: GPUBindGroup;
  readonly buffer: GPUBuffer;
}

const backgroundShader = /* wgsl */ `
${cameraStruct}
@group(0) @binding(0) var<uniform> camera: Camera;

struct BackgroundColors {
  top: vec4<f32>,
  bottom: vec4<f32>,
};

@group(1) @binding(0) var<uniform> background: BackgroundColors;

struct BackgroundOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> BackgroundOutput {
  var output: BackgroundOutput;
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  output.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let amount = clamp(position.y / max(camera.viewport.y, 1.0), 0.0, 1.0);
  return mix(background.top, background.bottom, amount);
}
`;

/** Creates the one pipeline and uniform used by every background preset. */
export async function createBackgroundResources(
  device: GPUDevice,
  cameraLayout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation?: GpuValidationOptions,
): Promise<BackgroundResources> {
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const module = await createValidatedShaderModule(
    device,
    "viewport background",
    backgroundShader,
    validation,
  );
  const pipeline = await createValidatedRenderPipeline(device, "viewport background", {
    layout: device.createPipelineLayout({ bindGroupLayouts: [cameraLayout, layout] }),
    vertex: { module, entryPoint: "vertexMain" },
    fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: "always",
      stencilReadMask: 0,
      stencilWriteMask: 0,
    },
    multisample: { count: COLOR_SAMPLE_COUNT },
  });
  const buffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer } }],
  });
  const resources = { pipeline, bindGroup, buffer };
  writeBackgroundColors(device, resources, "studio");
  return resources;
}

/** Writes the selected preset's two color endpoints without rebuilding resources. */
export function writeBackgroundColors(
  device: GPUDevice,
  resources: BackgroundResources,
  background: ViewportBackground,
): void {
  const colors = resolveBackgroundColors(background);
  const values = new Float32Array([...colors.top, ...colors.bottom]);
  device.queue.writeBuffer(resources.buffer, 0, values);
}

/** Releases the background buffer owned by the renderer resource bundle. */
export function destroyBackgroundResources(resources: BackgroundResources): void {
  resources.buffer.destroy();
}
