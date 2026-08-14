import { COLOR_SAMPLE_COUNT, vertexLayout } from "./gpu-support";
import { sectionPlaneFunction, sectionPlaneBindings } from "./gpu-shaders";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "./gpu-validation";

export interface NodeOverlayPipelines {
  readonly visible: GPURenderPipeline;
}

interface NodeOverlayOptions {
  readonly device: GPUDevice;
  readonly cameraLayout: GPUBindGroupLayout;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly pointVertexModule: GPUShaderModule;
  readonly validation: GpuValidationOptions | undefined;
}

/** Creates the depth-tested FE-node annotation pass. */
export function createNodeOverlayPipelines(
  options: NodeOverlayOptions,
): Promise<NodeOverlayPipelines> {
  const layout = options.device.createPipelineLayout({
    bindGroupLayouts: [options.cameraLayout, options.instanceLayout],
  });
  return createNodePipeline({ ...options, layout }).then((visible) => ({ visible }));
}

interface NodePipelineOptions extends NodeOverlayOptions {
  readonly layout: GPUPipelineLayout;
}

async function createNodePipeline(options: NodePipelineOptions): Promise<GPURenderPipeline> {
  const fragmentModule = await createValidatedShaderModule(
    options.device,
    "node annotation fragment",
    nodeOverlayFragmentShader,
    options.validation,
  );
  return createValidatedRenderPipeline(options.device, "node annotation overlay", {
    layout: options.layout,
    vertex: {
      module: options.pointVertexModule,
      entryPoint: "nodeOverlayVertexMain",
      buffers: [vertexLayout],
    },
    fragment: {
      module: fragmentModule,
      entryPoint: "nodeOverlayFragmentMain",
      targets: [{ format: options.format, writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: options.depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: COLOR_SAMPLE_COUNT, alphaToCoverageEnabled: true },
  });
}

export const nodeOverlayFragmentShader = /* wgsl */ `
${sectionPlaneBindings}
${sectionPlaneFunction}

@fragment
fn nodeOverlayFragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(9) @interpolate(flat) selected: u32,
) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  let emphasized = selected != 0u || emissive > 0.0;
  let displayedColor = select(vec3<f32>(0.0), color.rgb + vec3<f32>(emissive), emphasized);
  return vec4<f32>(displayedColor, select(0.45, color.a, emphasized));
}
`;
