import { colorFragmentShader, edgeFragmentShader, triangleColorFragmentShader } from "./scene";
import { edgeVertexShader } from "./edge";
import {
  instanceVertexShader,
  lineSelectionVertexShader,
  lineVertexShader,
  pointVertexShader,
  selectionVertexShader,
} from "./instanced";
import { nodeOverlayVertexShader } from "./node-overlay-vertex";
import {
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
} from "../picking/node-pick";
import {
  transparencyFragmentShader,
  triangleTransparencyFragmentShader,
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_BLEND_STATES,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "../frame/transparency";
import { createSelectionPipelines, type SelectionPipelines } from "./selection-pipelines";
import { PICK_TEXTURE_FORMAT } from "../picking/pick-format";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "../resources/foundation";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

export interface DrawPipelines extends SelectionPipelines {
  readonly trianglesColor: GPURenderPipeline;
  readonly trianglesTransparent: GPURenderPipeline;
  readonly trianglesPick: GPURenderPipeline;
  readonly linesColor: GPURenderPipeline;
  readonly linesTransparent: GPURenderPipeline;
  readonly linesPick: GPURenderPipeline;
  readonly pointsColor: GPURenderPipeline;
  readonly pointsTransparent: GPURenderPipeline;
  readonly pointsPick: GPURenderPipeline;
  readonly trianglesSelectionVisible: GPURenderPipeline;
  readonly trianglesSelectionHidden: GPURenderPipeline;
  readonly linesSelectionVisible: GPURenderPipeline;
  readonly linesSelectionHidden: GPURenderPipeline;
  readonly pointsSelectionVisible: GPURenderPipeline;
  readonly pointsSelectionHidden: GPURenderPipeline;
}

export interface PipelineResources {
  readonly pipelines: DrawPipelines;
  readonly edgePipeline: GPURenderPipeline;
  readonly edgeAlwaysPipeline: GPURenderPipeline;
  readonly nodeVertexModule: GPUShaderModule;
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
}

interface PipelineShaders {
  readonly triangleVertex: GPUShaderModule;
  readonly lineVertex: GPUShaderModule;
  readonly lineSelectionVertex: GPUShaderModule;
  readonly selectionVertex: GPUShaderModule;
  readonly pointVertex: GPUShaderModule;
  readonly nodeVertex: GPUShaderModule;
  readonly lineNodeVertex: GPUShaderModule;
  readonly pointNodeVertex: GPUShaderModule;
  readonly colorFragment: GPUShaderModule;
  readonly triangleColorFragment: GPUShaderModule;
  readonly transparencyFragment: GPUShaderModule;
  readonly triangleTransparencyFragment: GPUShaderModule;
  readonly nodePickVertex: GPUShaderModule;
  readonly nodePickFragment: GPUShaderModule;
}

interface PrimitiveSpec {
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
  readonly depthCompare?: GPUCompareFunction;
}

interface PipelineVariants {
  readonly triangles: PrimitiveSpec;
  readonly lines: PrimitiveSpec;
  readonly points: PrimitiveSpec;
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

interface PrimitivePipelines {
  readonly color: GPURenderPipeline;
  readonly transparent: GPURenderPipeline;
  readonly pick: GPURenderPipeline;
}

interface PrimitivePipelineOptions {
  readonly device: GPUDevice;
  readonly layout: GPUPipelineLayout;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly label: string;
  readonly variant: PrimitiveSpec;
  readonly colorFragment: GPUShaderModule;
  readonly transparencyFragment: GPUShaderModule;
  readonly pickVertex: GPUShaderModule;
  readonly pickFragment: GPUShaderModule;
}

/** Compiles and validates every draw and edge shader/pipeline used by a bundle. */
export async function createPipelineResources(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation?: GpuValidationOptions,
): Promise<PipelineResources> {
  const shaders = await createPipelineShaders(device, validation);
  const basePipelines = await buildPipelines(device, layout, format, depthFormat, shaders);
  const selectionPipelines = await createSelectionPipelines({
    device,
    layout,
    format,
    depthFormat,
    validation,
    triangleVertex: shaders.triangleVertex,
    lineSelectionVertex: shaders.lineSelectionVertex,
    selectionVertex: shaders.selectionVertex,
    pointVertex: shaders.pointVertex,
    nodeVertex: shaders.nodeVertex,
  });
  const pipelines: DrawPipelines = { ...basePipelines, ...selectionPipelines };
  const edges = await createEdgePipelines(device, layout, format, depthFormat, validation);
  return { pipelines, ...edges, nodeVertexModule: shaders.nodeVertex };
}

async function createPipelineShaders(
  device: GPUDevice,
  validation: GpuValidationOptions | undefined,
): Promise<PipelineShaders> {
  const compile = (label: string, code: string) =>
    createValidatedShaderModule(device, label, code, validation);
  const [triangleVertex, lineVertex, lineSelectionVertex, pointVertex, selectionVertex] =
    await Promise.all([
      compile("triangle color vertex", instanceVertexShader),
      compile("line color vertex", lineVertexShader),
      compile("line selection vertex", lineSelectionVertexShader),
      compile("point color vertex", pointVertexShader),
      compile("triangle selection vertex", selectionVertexShader),
    ]);
  const nodeVertex = await compile("node overlay vertex", nodeOverlayVertexShader);
  const [lineNodeVertex, pointNodeVertex] = await Promise.all([
    compile("line node picking vertex", lineNodePickVertexShader),
    compile("point node picking vertex", pointNodePickVertexShader),
  ]);
  const [colorFragment, triangleColorFragment, transparencyFragment, triangleTransparencyFragment] =
    await Promise.all([
      compile("line and point color fragment", colorFragmentShader),
      compile("triangle color fragment", triangleColorFragmentShader),
      compile("line and point transparency fragment", transparencyFragmentShader),
      compile("triangle transparency fragment", triangleTransparencyFragmentShader),
    ]);
  const [nodePickVertex, nodePickFragment] = await Promise.all([
    compile("triangle node picking vertex", nodePickVertexShader),
    compile("node picking fragment", nodePickFragmentShader),
  ]);
  return {
    triangleVertex,
    lineVertex,
    lineSelectionVertex,
    selectionVertex,
    pointVertex,
    nodeVertex,
    lineNodeVertex,
    pointNodeVertex,
    colorFragment,
    triangleColorFragment,
    transparencyFragment,
    triangleTransparencyFragment,
    nodePickVertex,
    nodePickFragment,
  };
}

function pipelineVariants(shaders: PipelineShaders): PipelineVariants {
  return {
    triangles: {
      vertexModule: shaders.triangleVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list",
      cullMode: "none",
    },
    lines: {
      vertexModule: shaders.lineVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list",
      cullMode: "none",
      depthCompare: "less-equal",
    },
    points: {
      vertexModule: shaders.pointVertex,
      vertexEntry: "pointVertexMain",
      primitive: "triangle-list",
      cullMode: "none",
      depthCompare: "less-equal",
    },
  };
}

async function buildPipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  shaders: PipelineShaders,
): Promise<Omit<DrawPipelines, keyof SelectionPipelines>> {
  const variants = pipelineVariants(shaders);
  const [triangles, lines, points] = await Promise.all([
    createPrimitivePipelines({
      device,
      layout,
      format,
      depthFormat,
      label: "triangle",
      variant: variants.triangles,
      colorFragment: shaders.triangleColorFragment,
      transparencyFragment: shaders.triangleTransparencyFragment,
      pickVertex: shaders.nodePickVertex,
      pickFragment: shaders.nodePickFragment,
    }),
    createPrimitivePipelines({
      device,
      layout,
      format,
      depthFormat,
      label: "line",
      variant: variants.lines,
      colorFragment: shaders.colorFragment,
      transparencyFragment: shaders.transparencyFragment,
      pickVertex: shaders.lineNodeVertex,
      pickFragment: shaders.nodePickFragment,
    }),
    createPrimitivePipelines({
      device,
      layout,
      format,
      depthFormat,
      label: "point",
      variant: variants.points,
      colorFragment: shaders.colorFragment,
      transparencyFragment: shaders.transparencyFragment,
      pickVertex: shaders.pointNodeVertex,
      pickFragment: shaders.nodePickFragment,
    }),
  ]);
  return {
    trianglesColor: triangles.color,
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

async function createPrimitivePipelines(
  options: PrimitivePipelineOptions,
): Promise<PrimitivePipelines> {
  const {
    device,
    layout,
    format,
    depthFormat,
    label,
    variant,
    colorFragment,
    transparencyFragment,
    pickVertex,
    pickFragment,
  } = options;
  const [color, transparent, pick] = await Promise.all([
    createPipeline(device, layout, `${label} color`, {
      ...variant,
      fragmentModule: colorFragment,
      passFormats: [format],
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
    }),
    createPipeline(device, layout, `${label} transparency`, {
      ...variant,
      fragmentModule: transparencyFragment,
      passFormats: TRANSPARENT_FORMATS,
      blendStates: TRANSPARENCY_BLEND_STATES,
      depthFormat,
      sampleCount: COLOR_SAMPLE_COUNT,
      depthWriteEnabled: false,
    }),
    createPipeline(device, layout, `${label} picking`, {
      ...variant,
      vertexModule: pickVertex,
      fragmentModule: pickFragment,
      passFormats: PICK_FORMATS,
      depthFormat,
      sampleCount: 1,
    }),
  ]);
  return { color, transparent, pick };
}

async function createPipeline(
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
      buffers: [vertexLayout],
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
    },
    multisample: { count: spec.sampleCount },
  });
}

async function createEdgePipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation: GpuValidationOptions | undefined,
): Promise<Pick<PipelineResources, "edgePipeline" | "edgeAlwaysPipeline">> {
  const vertexModule = await createValidatedShaderModule(
    device,
    "edge overlay vertex",
    edgeVertexShader,
    validation,
  );
  const fragmentModule = await createValidatedShaderModule(
    device,
    "edge overlay fragment",
    edgeFragmentShader,
    validation,
  );
  const create = (label: string, depthCompare: GPUCompareFunction): Promise<GPURenderPipeline> =>
    createValidatedRenderPipeline(device, label, {
      layout,
      vertex: { module: vertexModule, entryPoint: "vertexMain", buffers: [vertexLayout] },
      fragment: {
        module: fragmentModule,
        entryPoint: "fragmentMain",
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
      primitive: { topology: "line-list", cullMode: "none" },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare,
      },
      multisample: { count: 1 },
    });
  const [edgePipeline, edgeAlwaysPipeline] = await Promise.all([
    create("edge overlay depth-tested", "less-equal"),
    create("edge overlay always-visible", "always"),
  ]);
  return { edgePipeline, edgeAlwaysPipeline };
}
