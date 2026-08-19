import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_BLEND_STATES,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "../frame/transparency";
import { PICK_TEXTURE_FORMAT } from "../picking/pick-format";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "../resources/foundation";
import { createValidatedRenderPipeline } from "../diagnostics/validation";

export interface BasePipelineShaders {
  readonly triangleVertex: GPUShaderModule;
  readonly lineVertex: GPUShaderModule;
  readonly pointVertex: GPUShaderModule;
  readonly colorFragment: GPUShaderModule;
  readonly triangleColorFragment: GPUShaderModule;
  readonly transparencyFragment: GPUShaderModule;
  readonly triangleTransparencyFragment: GPUShaderModule;
  readonly nodePickVertex: GPUShaderModule;
  readonly lineNodeVertex: GPUShaderModule;
  readonly pointNodeVertex: GPUShaderModule;
  readonly nodePickFragment: GPUShaderModule;
}

export interface BasePipelines {
  readonly trianglesColor: GPURenderPipeline;
  readonly denseSelectionTrianglesColor: GPURenderPipeline;
  readonly trianglesTransparent: GPURenderPipeline;
  readonly trianglesPick: GPURenderPipeline;
  readonly linesColor: GPURenderPipeline;
  readonly linesTransparent: GPURenderPipeline;
  readonly linesPick: GPURenderPipeline;
  readonly pointsColor: GPURenderPipeline;
  readonly pointsTransparent: GPURenderPipeline;
  readonly pointsPick: GPURenderPipeline;
}

interface PipelineSpec {
  readonly depthFormat: GPUTextureFormat;
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly fragmentModule: GPUShaderModule;
  readonly passFormats: readonly GPUTextureFormat[];
  readonly blendStates?: readonly (GPUBlendState | undefined)[];
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
  readonly sampleCount: number;
  readonly depthCompare?: GPUCompareFunction;
  readonly depthWriteEnabled?: boolean;
  readonly depthBias?: number;
  readonly vertexBuffers?: GPUVertexBufferLayout[];
}

interface PrimitiveSpec {
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
  readonly depthCompare?: GPUCompareFunction;
  readonly vertexBuffers?: GPUVertexBufferLayout[];
}

interface PrimitivePipelines {
  readonly color: GPURenderPipeline;
  readonly transparent: GPURenderPipeline;
  readonly pick: GPURenderPipeline;
}

const PICK_FORMATS = [
  PICK_TEXTURE_FORMAT,
  PICK_TEXTURE_FORMAT,
  PICK_TEXTURE_FORMAT,
  PICK_TEXTURE_FORMAT,
] as const;
const TRANSPARENT_FORMATS = [
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_REVEALAGE_FORMAT,
] as const;

/** Builds the full primitive pipeline family sharing the canonical layout. */
export async function createBasePipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  shaders: BasePipelineShaders,
): Promise<BasePipelines> {
  const variants = primitiveVariants(shaders);
  return Promise.all([
    createPrimitivePipelines(device, layout, format, depthFormat, {
      label: "triangle",
      variant: variants.triangles,
      fragments: {
        color: shaders.triangleColorFragment,
        transparency: shaders.triangleTransparencyFragment,
        pickVertex: shaders.nodePickVertex,
        pickFragment: shaders.nodePickFragment,
      },
    }),
    createPipeline(device, layout, "dense-selection triangle color", {
      ...variants.triangles,
      fragmentModule: shaders.triangleColorFragment,
      passFormats: [format],
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
      depthBias: -1,
    }),
    createPrimitivePipelines(device, layout, format, depthFormat, {
      label: "line",
      variant: variants.lines,
      fragments: {
        color: shaders.colorFragment,
        transparency: shaders.transparencyFragment,
        pickVertex: shaders.lineNodeVertex,
        pickFragment: shaders.nodePickFragment,
      },
    }),
    createPrimitivePipelines(device, layout, format, depthFormat, {
      label: "point",
      variant: variants.points,
      fragments: {
        color: shaders.colorFragment,
        transparency: shaders.transparencyFragment,
        pickVertex: shaders.pointNodeVertex,
        pickFragment: shaders.nodePickFragment,
      },
    }),
  ]).then(([triangles, denseSelectionTrianglesColor, lines, points]) => ({
    trianglesColor: triangles.color,
    denseSelectionTrianglesColor,
    trianglesTransparent: triangles.transparent,
    trianglesPick: triangles.pick,
    linesColor: lines.color,
    linesTransparent: lines.transparent,
    linesPick: lines.pick,
    pointsColor: points.color,
    pointsTransparent: points.transparent,
    pointsPick: points.pick,
  }));
}

function primitiveVariants(
  shaders: BasePipelineShaders,
): Record<"triangles" | "lines" | "points", PrimitiveSpec> {
  return {
    triangles: {
      vertexModule: shaders.triangleVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list" as const,
      cullMode: "none" as const,
      vertexBuffers: [],
    },
    lines: {
      vertexModule: shaders.lineVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list" as const,
      cullMode: "none" as const,
      depthCompare: "less-equal" as const,
    },
    points: {
      vertexModule: shaders.pointVertex,
      vertexEntry: "pointVertexMain",
      primitive: "triangle-list" as const,
      cullMode: "none" as const,
      depthCompare: "less-equal" as const,
    },
  };
}

interface FragmentPipelines {
  readonly color: GPUShaderModule;
  readonly transparency: GPUShaderModule;
  readonly pickVertex: GPUShaderModule;
  readonly pickFragment: GPUShaderModule;
}

function createPrimitivePipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  options: {
    readonly label: string;
    readonly variant: PrimitiveSpec;
    readonly fragments: FragmentPipelines;
  },
): Promise<PrimitivePipelines> {
  const { label, variant, fragments } = options;
  return Promise.all([
    createPipeline(device, layout, `${label} color`, {
      ...variant,
      fragmentModule: fragments.color,
      passFormats: [format],
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
    }),
    createPipeline(device, layout, `${label} transparency`, {
      ...variant,
      fragmentModule: fragments.transparency,
      passFormats: TRANSPARENT_FORMATS,
      blendStates: TRANSPARENCY_BLEND_STATES,
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    }),
    createPipeline(device, layout, `${label} picking`, {
      ...variant,
      vertexModule: fragments.pickVertex,
      fragmentModule: fragments.pickFragment,
      passFormats: PICK_FORMATS,
      depthFormat,
      sampleCount: 1,
    }),
  ]).then(([color, transparent, pick]) => ({ color, transparent, pick }));
}

function createPipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  label: string,
  spec: PipelineSpec,
): Promise<GPURenderPipeline> {
  return createValidatedRenderPipeline(device, label, {
    layout,
    vertex: {
      module: spec.vertexModule,
      entryPoint: spec.vertexEntry,
      buffers: spec.vertexBuffers ?? [vertexLayout],
    },
    fragment: {
      module: spec.fragmentModule,
      entryPoint: "fragmentMain",
      targets: spec.passFormats.map((passFormat, index) => {
        const blend = spec.blendStates?.[index];
        return blend === undefined ? { format: passFormat } : { format: passFormat, blend };
      }),
    },
    primitive: { topology: spec.primitive, cullMode: spec.cullMode },
    depthStencil: {
      format: spec.depthFormat,
      depthWriteEnabled: spec.depthWriteEnabled ?? true,
      depthCompare: spec.depthCompare ?? "less",
      ...(spec.depthBias === undefined ? {} : { depthBias: spec.depthBias }),
    },
    multisample: { count: spec.sampleCount },
  });
}
