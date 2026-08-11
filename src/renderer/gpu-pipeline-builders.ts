import {
  colorFragmentShader,
  edgeFragmentShader,
  edgeVertexShader,
  triangleColorFragmentShader,
} from "./gpu-shaders";
import { instanceVertexShader, lineVertexShader, pointVertexShader } from "./gpu-instanced-shaders";
import {
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
} from "./gpu-node-pick";
import { PICK_TEXTURE_FORMAT } from "./pick-format";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "./gpu-support";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "./gpu-validation";

export interface DrawPipelines {
  readonly trianglesColor: GPURenderPipeline;
  readonly trianglesPick: GPURenderPipeline;
  readonly linesColor: GPURenderPipeline;
  readonly linesPick: GPURenderPipeline;
  readonly pointsColor: GPURenderPipeline;
  readonly pointsPick: GPURenderPipeline;
}

export interface PipelineResources {
  readonly pipelines: DrawPipelines;
  readonly edgePipeline: GPURenderPipeline;
  readonly edgeAlwaysPipeline: GPURenderPipeline;
  readonly pointVertexModule: GPUShaderModule;
}

interface PipelineSpec {
  readonly depthFormat: GPUTextureFormat;
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly fragmentModule: GPUShaderModule;
  readonly passFormats: readonly GPUTextureFormat[];
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
  readonly sampleCount: number;
}

interface PipelineShaders {
  readonly triangleVertex: GPUShaderModule;
  readonly lineVertex: GPUShaderModule;
  readonly pointVertex: GPUShaderModule;
  readonly lineNodeVertex: GPUShaderModule;
  readonly pointNodeVertex: GPUShaderModule;
  readonly colorFragment: GPUShaderModule;
  readonly triangleColorFragment: GPUShaderModule;
  readonly nodePickVertex: GPUShaderModule;
  readonly nodePickFragment: GPUShaderModule;
}

interface PrimitiveSpec {
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly primitive: GPUPrimitiveTopology;
  readonly cullMode: GPUCullMode;
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

/** Compiles and validates every draw and edge shader/pipeline used by a bundle. */
export async function createPipelineResources(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation?: GpuValidationOptions,
): Promise<PipelineResources> {
  const shaders = await createPipelineShaders(device, validation);
  const pipelines = await buildPipelines(device, layout, format, depthFormat, shaders);
  const edges = await createEdgePipelines(device, layout, format, depthFormat, validation);
  return { pipelines, ...edges, pointVertexModule: shaders.pointVertex };
}

async function createPipelineShaders(
  device: GPUDevice,
  validation: GpuValidationOptions | undefined,
): Promise<PipelineShaders> {
  const compile = (label: string, code: string) =>
    createValidatedShaderModule(device, label, code, validation);
  const [triangleVertex, lineVertex, pointVertex] = await Promise.all([
    compile("triangle color vertex", instanceVertexShader),
    compile("line color vertex", lineVertexShader),
    compile("point color vertex", pointVertexShader),
  ]);
  const [lineNodeVertex, pointNodeVertex] = await Promise.all([
    compile("line node picking vertex", lineNodePickVertexShader),
    compile("point node picking vertex", pointNodePickVertexShader),
  ]);
  const [colorFragment, triangleColorFragment] = await Promise.all([
    compile("line and point color fragment", colorFragmentShader),
    compile("triangle color fragment", triangleColorFragmentShader),
  ]);
  const [nodePickVertex, nodePickFragment] = await Promise.all([
    compile("triangle node picking vertex", nodePickVertexShader),
    compile("node picking fragment", nodePickFragmentShader),
  ]);
  return {
    triangleVertex,
    lineVertex,
    pointVertex,
    lineNodeVertex,
    pointNodeVertex,
    colorFragment,
    triangleColorFragment,
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
      primitive: "line-list",
      cullMode: "none",
    },
    points: {
      vertexModule: shaders.pointVertex,
      vertexEntry: "pointVertexMain",
      primitive: "triangle-list",
      cullMode: "none",
    },
  };
}

async function buildPipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  shaders: PipelineShaders,
): Promise<DrawPipelines> {
  const variants = pipelineVariants(shaders);
  const [trianglesColor, trianglesPick, linesColor, linesPick, pointsColor, pointsPick] =
    await Promise.all([
      createPipeline(device, layout, "triangle color", {
        ...variants.triangles,
        fragmentModule: shaders.triangleColorFragment,
        passFormats: [format],
        depthFormat,
        sampleCount: COLOR_SAMPLE_COUNT,
      }),
      createPipeline(device, layout, "triangle picking", {
        ...variants.triangles,
        vertexModule: shaders.nodePickVertex,
        fragmentModule: shaders.nodePickFragment,
        passFormats: PICK_FORMATS,
        depthFormat,
        sampleCount: 1,
      }),
      createPipeline(device, layout, "line color", {
        ...variants.lines,
        fragmentModule: shaders.colorFragment,
        passFormats: [format],
        depthFormat,
        sampleCount: COLOR_SAMPLE_COUNT,
      }),
      createPipeline(device, layout, "line picking", {
        ...variants.lines,
        vertexModule: shaders.lineNodeVertex,
        fragmentModule: shaders.nodePickFragment,
        passFormats: PICK_FORMATS,
        depthFormat,
        sampleCount: 1,
      }),
      createPipeline(device, layout, "point color", {
        ...variants.points,
        fragmentModule: shaders.colorFragment,
        passFormats: [format],
        depthFormat,
        sampleCount: COLOR_SAMPLE_COUNT,
      }),
      createPipeline(device, layout, "point picking", {
        ...variants.points,
        vertexModule: shaders.pointNodeVertex,
        fragmentModule: shaders.nodePickFragment,
        passFormats: PICK_FORMATS,
        depthFormat,
        sampleCount: 1,
      }),
    ]);
  return { trianglesColor, trianglesPick, linesColor, linesPick, pointsColor, pointsPick };
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
      targets: spec.passFormats.map((passFormat) => ({ format: passFormat })),
    },
    primitive: { topology: spec.primitive, cullMode: spec.cullMode },
    depthStencil: {
      format: spec.depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
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
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare },
      multisample: { count: COLOR_SAMPLE_COUNT },
    });
  const [edgePipeline, edgeAlwaysPipeline] = await Promise.all([
    create("edge overlay depth-tested", "less-equal"),
    create("edge overlay always-visible", "always"),
  ]);
  return { edgePipeline, edgeAlwaysPipeline };
}
