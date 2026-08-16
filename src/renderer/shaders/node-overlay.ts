import { COLOR_SAMPLE_COUNT, vertexLayout } from "../resources/foundation";
import { sectionPlaneFunction, sectionPlaneBindings } from "./scene";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

export interface NodeOverlayPipelines {
  readonly visible: GPURenderPipeline;
  readonly resolved: GPURenderPipeline;
}

interface NodeOverlayOptions {
  readonly device: GPUDevice;
  readonly cameraLayout: GPUBindGroupLayout;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly nodeVertexModule: GPUShaderModule;
  readonly validation: GpuValidationOptions | undefined;
}

/** Creates the depth-tested FE-node annotation pass. */
export function createNodeOverlayPipelines(
  options: NodeOverlayOptions,
): Promise<NodeOverlayPipelines> {
  const layout = options.device.createPipelineLayout({
    bindGroupLayouts: [options.cameraLayout, options.instanceLayout],
  });
  return createNodePipelines({ ...options, layout });
}

interface NodePipelineOptions extends NodeOverlayOptions {
  readonly layout: GPUPipelineLayout;
}

async function createNodePipelines(options: NodePipelineOptions): Promise<NodeOverlayPipelines> {
  const fragmentModule = await createValidatedShaderModule(
    options.device,
    "node annotation fragment",
    nodeOverlayFragmentShader,
    options.validation,
  );
  const create = (
    label: string,
    fragmentEntry: string,
    sampleCount: number,
    resolved: boolean,
  ): Promise<GPURenderPipeline> =>
    createValidatedRenderPipeline(options.device, label, {
      layout: options.layout,
      vertex: {
        module: options.nodeVertexModule,
        entryPoint: "nodeOverlayVertexMain",
        buffers: [vertexLayout],
      },
      fragment: {
        module: fragmentModule,
        entryPoint: fragmentEntry,
        targets: [
          {
            format: options.format,
            writeMask: 0xf,
            ...(resolved
              ? {
                  blend: {
                    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" } as const,
                    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } as const,
                  },
                }
              : {}),
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: options.depthFormat,
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
      multisample: {
        count: sampleCount,
        ...(resolved ? {} : { alphaToCoverageEnabled: true }),
      },
    });
  const [visible, resolved] = await Promise.all([
    create("node annotation overlay", "nodeOverlayFragmentMain", COLOR_SAMPLE_COUNT, false),
    create("resolved node annotation overlay", "nodeOverlayResolvedFragmentMain", 1, true),
  ]);
  return { visible, resolved };
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
