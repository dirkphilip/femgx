import { COLOR_SAMPLE_COUNT } from "../resources/foundation";
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

type NodeSpriteOrder = "expanded" | "compact";

const NODE_SPRITE_VERTEX_ENTRIES = {
  expanded: "nodeOverlayVertexMain",
  compact: "compactSelectedNodeOverlayVertexMain",
} as const satisfies Record<NodeSpriteOrder, string>;

/** Returns the family-owned procedural node-sprite geometry contract. */
export function nodeSpritePipelineGeometry(
  vertexModule: GPUShaderModule,
  order: NodeSpriteOrder,
): Required<Pick<GPURenderPipelineDescriptor, "vertex" | "primitive">> {
  return {
    vertex: {
      module: vertexModule,
      entryPoint: NODE_SPRITE_VERTEX_ENTRIES[order],
      buffers: [],
    },
    primitive: { topology: "triangle-strip", cullMode: "none" },
  };
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
  const geometry = nodeSpritePipelineGeometry(options.pointVertexModule, "expanded");
  const create = (
    label: string,
    fragmentEntry: "nodeOverlayFragmentMain" | "nodeOverlayResolvedFragmentMain",
    target: GPUColorTargetState,
    multisample: GPUMultisampleState,
  ) =>
    createValidatedRenderPipeline(options.device, label, {
      layout: options.layout,
      ...geometry,
      fragment: { module: fragmentModule, entryPoint: fragmentEntry, targets: [target] },
      depthStencil: {
        format: options.depthFormat,
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
      multisample,
    });
  const [visible, resolved] = await Promise.all([
    create(
      "node annotation overlay",
      "nodeOverlayFragmentMain",
      { format: options.format, writeMask: 0xf },
      { count: COLOR_SAMPLE_COUNT, alphaToCoverageEnabled: true },
    ),
    create(
      "resolved node annotation overlay",
      "nodeOverlayResolvedFragmentMain",
      {
        format: options.format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        },
      },
      { count: 1 },
    ),
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
