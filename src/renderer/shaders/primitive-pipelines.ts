import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_BLEND_STATES,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "../frame/transparency";
import { PICK_TEXTURE_FORMAT } from "../picking/pick-format";
import { COLOR_SAMPLE_COUNT } from "../resources/foundation";
import { createValidatedRenderPipeline } from "../diagnostics/validation";
import { instancedPrimitiveGeometry } from "./instanced-primitive-geometry";

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
  readonly geometry: ReturnType<typeof instancedPrimitiveGeometry>;
  readonly fragmentModule: GPUShaderModule;
  readonly passFormats: readonly GPUTextureFormat[];
  readonly blendStates?: readonly (GPUBlendState | undefined)[];
  readonly sampleCount: number;
  readonly depthCompare: GPUCompareFunction;
  readonly depthWriteEnabled?: boolean;
  readonly depthBias?: number;
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
  const triangleGeometry = instancedPrimitiveGeometry("triangles", shaders.triangleVertex);
  return Promise.all([
    createPrimitivePipelines(device, layout, format, depthFormat, {
      label: "triangle",
      geometry: triangleGeometry,
      depthCompare: "less",
      fragments: {
        color: shaders.triangleColorFragment,
        transparency: shaders.triangleTransparencyFragment,
        pickVertex: shaders.nodePickVertex,
        pickFragment: shaders.nodePickFragment,
      },
    }),
    createPipeline(device, layout, "dense-selection triangle color", {
      geometry: triangleGeometry,
      fragmentModule: shaders.triangleColorFragment,
      passFormats: [format],
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
      depthCompare: "less",
      depthBias: -1,
    }),
    createPrimitivePipelines(device, layout, format, depthFormat, {
      label: "line",
      geometry: instancedPrimitiveGeometry("lines", shaders.lineVertex),
      depthCompare: "less-equal",
      fragments: {
        color: shaders.colorFragment,
        transparency: shaders.transparencyFragment,
        pickVertex: shaders.lineNodeVertex,
        pickFragment: shaders.nodePickFragment,
      },
    }),
    createPrimitivePipelines(device, layout, format, depthFormat, {
      label: "point",
      geometry: instancedPrimitiveGeometry("points", shaders.pointVertex),
      depthCompare: "less-equal",
      fragments: {
        color: shaders.colorFragment,
        transparency: shaders.transparencyFragment,
        pickVertex: shaders.pointNodeVertex,
        pickFragment: shaders.nodePickFragment,
      },
    }),
  ]).then(assembleBasePipelines);
}

function assembleBasePipelines([triangles, denseSelectionTrianglesColor, lines, points]: readonly [
  PrimitivePipelines,
  GPURenderPipeline,
  PrimitivePipelines,
  PrimitivePipelines,
]): BasePipelines {
  return {
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
    readonly geometry: ReturnType<typeof instancedPrimitiveGeometry>;
    readonly depthCompare: GPUCompareFunction;
    readonly fragments: FragmentPipelines;
  },
): Promise<PrimitivePipelines> {
  const { label, geometry, depthCompare, fragments } = options;
  return Promise.all([
    createPipeline(device, layout, `${label} color`, {
      geometry,
      fragmentModule: fragments.color,
      passFormats: [format],
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
      depthCompare,
    }),
    createPipeline(device, layout, `${label} transparency`, {
      geometry,
      fragmentModule: fragments.transparency,
      passFormats: TRANSPARENT_FORMATS,
      blendStates: TRANSPARENCY_BLEND_STATES,
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    }),
    createPipeline(device, layout, `${label} picking`, {
      geometry: { ...geometry, vertex: { ...geometry.vertex, module: fragments.pickVertex } },
      fragmentModule: fragments.pickFragment,
      passFormats: PICK_FORMATS,
      depthFormat,
      sampleCount: 1,
      depthCompare,
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
    vertex: spec.geometry.vertex,
    fragment: {
      module: spec.fragmentModule,
      entryPoint: "fragmentMain",
      targets: spec.passFormats.map((passFormat, index) => {
        const blend = spec.blendStates?.[index];
        return blend === undefined ? { format: passFormat } : { format: passFormat, blend };
      }),
    },
    primitive: spec.geometry.primitive,
    depthStencil: {
      format: spec.depthFormat,
      depthWriteEnabled: spec.depthWriteEnabled ?? true,
      depthCompare: spec.depthCompare,
      ...(spec.depthBias === undefined ? {} : { depthBias: spec.depthBias }),
    },
    multisample: { count: spec.sampleCount },
  });
}
