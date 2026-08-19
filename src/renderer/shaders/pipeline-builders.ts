import { colorFragmentShader, edgeFragmentShader, triangleColorFragmentShader } from "./scene";
import { edgeVertexShader } from "./edge";
import { createMinimalPipelines } from "./minimal-pipeline";
import {
  instanceVertexShader,
  lineSelectionVertexShader,
  lineVertexShader,
  pointVertexShader,
  selectionVertexShader,
} from "./instanced";
import {
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
} from "../picking/node-pick";
import {
  transparencyFragmentShader,
  triangleTransparencyFragmentShader,
} from "../frame/transparency";
import { createBasePipelines, type BasePipelineShaders } from "./primitive-pipelines";
import { createSelectionPipelines, type SelectionPipelines } from "./selection-pipelines";
import { vertexLayout } from "../resources/foundation";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

export interface DrawPipelines extends SelectionPipelines {
  readonly minimalTrianglesColor: GPURenderPipeline;
  readonly minimalTrianglesTransparent: GPURenderPipeline;
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
  readonly pointVertexModule: GPUShaderModule;
}

interface PipelineShaders extends BasePipelineShaders {
  readonly lineSelectionVertex: GPUShaderModule;
  readonly selectionVertex: GPUShaderModule;
}

/** Compiles and validates every draw and edge shader/pipeline used by a bundle. */
export async function createPipelineResources(
  device: GPUDevice,
  layouts: { readonly full: GPUPipelineLayout; readonly minimal: GPUPipelineLayout },
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation?: GpuValidationOptions,
): Promise<PipelineResources> {
  const shaders = await createPipelineShaders(device, validation);
  const [basePipelines, minimalPipelines] = await Promise.all([
    createBasePipelines(device, layouts.full, format, depthFormat, shaders),
    createMinimalPipelines(device, layouts.minimal, format, depthFormat, validation),
  ]);
  const selectionPipelines = await createSelectionPipelines({
    device,
    layout: layouts.full,
    format,
    depthFormat,
    validation,
    triangleVertex: shaders.triangleVertex,
    lineSelectionVertex: shaders.lineSelectionVertex,
    selectionVertex: shaders.selectionVertex,
    pointVertex: shaders.pointVertex,
  });
  const pipelines: DrawPipelines = {
    ...basePipelines,
    ...minimalPipelines,
    ...selectionPipelines,
  };
  const edges = await createEdgePipelines(device, layouts.full, format, depthFormat, validation);
  return { pipelines, ...edges, pointVertexModule: shaders.pointVertex };
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
