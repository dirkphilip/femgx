import { COLOR_SAMPLE_COUNT } from "../resources/foundation";
import { sectionPlaneFunction, sectionPlaneBindings } from "./scene";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

export interface NodeOverlayPipelines {
  readonly visible: GPURenderPipeline;
  readonly resolved: ResolvedNodeOverlay;
}

interface ResolvedNodeOverlay {
  readonly vertexModule: GPUShaderModule;
  readonly fragmentModule: GPUShaderModule;
  pipeline: GPURenderPipeline | undefined;
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
  return createNodePipeline({ ...options, layout });
}

interface NodePipelineOptions extends NodeOverlayOptions {
  readonly layout: GPUPipelineLayout;
}

async function createNodePipeline(options: NodePipelineOptions): Promise<NodeOverlayPipelines> {
  const fragmentModule = await createValidatedShaderModule(
    options.device,
    "node annotation fragment",
    nodeOverlayFragmentShader,
    options.validation,
  );
  const visible = await createValidatedRenderPipeline(options.device, "node annotation overlay", {
    layout: options.layout,
    vertex: {
      module: options.pointVertexModule,
      entryPoint: "nodeOverlayVertexMain",
      buffers: [],
    },
    fragment: {
      module: fragmentModule,
      entryPoint: "nodeOverlayFragmentMain",
      targets: [{ format: options.format, writeMask: 0xf }],
    },
    primitive: { topology: "triangle-strip", cullMode: "none" },
    depthStencil: {
      format: options.depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: COLOR_SAMPLE_COUNT, alphaToCoverageEnabled: true },
  });
  return {
    visible,
    resolved: { vertexModule: options.pointVertexModule, fragmentModule, pipeline: undefined },
  };
}

/** Creates the one-sample node pipeline only while resolved edge presentation is active. */
export function ensureResolvedNodeOverlayPipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  pipelines: NodeOverlayPipelines,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): GPURenderPipeline {
  pipelines.resolved.pipeline ??= device.createRenderPipeline({
    label: "resolved node annotation overlay",
    layout,
    vertex: {
      module: pipelines.resolved.vertexModule,
      entryPoint: "nodeOverlayVertexMain",
      buffers: [],
    },
    fragment: {
      module: pipelines.resolved.fragmentModule,
      entryPoint: "nodeOverlayResolvedFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: "less-equal" },
    multisample: { count: 1 },
  });
  return pipelines.resolved.pipeline;
}

/** Releases the optional resolved node pipeline when edge presentation becomes inactive. */
export function releaseResolvedNodeOverlayPipeline(pipelines: NodeOverlayPipelines): void {
  pipelines.resolved.pipeline = undefined;
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
  let radiusSquared = dot(local, local);
  if (radiusSquared > 1.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  let emphasized = selected != 0u || emissive > 0.0;
  let displayedColor = select(vec3<f32>(0.0), color.rgb + vec3<f32>(emissive), emphasized);
  return vec4<f32>(displayedColor, select(0.45, color.a, emphasized));
}

@fragment
fn nodeOverlayResolvedFragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(9) @interpolate(flat) selected: u32,
) -> @location(0) vec4<f32> {
  let radiusSquared = dot(local, local);
  if (radiusSquared > 1.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  let emphasized = selected != 0u || emissive > 0.0;
  let displayedColor = select(vec3<f32>(0.0), color.rgb + vec3<f32>(emissive), emphasized);
  let coverage = 1.0 - smoothstep(1.0 - fwidth(radiusSquared), 1.0, radiusSquared);
  return vec4<f32>(displayedColor, select(0.45, color.a, emphasized) * coverage);
}
`;
