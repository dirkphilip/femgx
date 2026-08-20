import {
  selectionFragmentShader,
  selectionTransparencyFragmentShader,
} from "../selection/selection";
import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_ACCUMULATION_BLEND_STATE,
  TRANSPARENCY_REVEALAGE_BLEND_STATE,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "../frame/transparency";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "../resources/foundation";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

export interface SelectionPipelines {
  readonly trianglesSelectionVisible: GPURenderPipeline;
  readonly trianglesSelectionHidden: GPURenderPipeline;
  readonly linesSelectionVisible: GPURenderPipeline;
  readonly linesSelectionHidden: GPURenderPipeline;
  readonly pointsSelectionVisible: GPURenderPipeline;
  readonly pointsSelectionHidden: GPURenderPipeline;
  readonly nodesSelectionVisible: GPURenderPipeline;
  readonly nodesSelectionHidden: GPURenderPipeline;
}

interface SelectionPipelineOptions {
  readonly device: GPUDevice;
  readonly layout: GPUPipelineLayout;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly validation: GpuValidationOptions | undefined;
  readonly triangleVertex: GPUShaderModule;
  readonly lineSelectionVertex: GPUShaderModule;
  readonly selectionVertex: GPUShaderModule;
  readonly pointVertex: GPUShaderModule;
}

interface PrimitiveSelectionOptions {
  readonly label: string;
  readonly vertexModule: GPUShaderModule;
  readonly vertexEntry: string;
  readonly primitive: GPUPrimitiveTopology;
  readonly visibleFragment: GPUShaderModule;
  readonly hiddenFragment: GPUShaderModule;
  readonly vertexBuffers?: GPUVertexBufferLayout[];
}

const SELECTION_BLEND_STATE: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

type SelectionPipelineBase = Omit<GPURenderPipelineDescriptor, "fragment" | "depthStencil"> & {
  readonly depthStencil: GPUDepthStencilState;
};

/** Compiles the visible and hidden selection variants for every primitive. */
export async function createSelectionPipelines(
  options: SelectionPipelineOptions,
): Promise<SelectionPipelines> {
  const [selection, selectionTransparency] = await compileSelectionFragments(options);
  const variants = await Promise.all([
    createPrimitiveSelectionPipelines({
      ...options,
      label: "triangle",
      vertexModule: options.selectionVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list",
      visibleFragment: selection,
      hiddenFragment: selectionTransparency,
      vertexBuffers: [],
    }),
    createPrimitiveSelectionPipelines({
      ...options,
      label: "line",
      vertexModule: options.lineSelectionVertex,
      vertexEntry: "vertexMain",
      primitive: "triangle-list",
      visibleFragment: selection,
      hiddenFragment: selectionTransparency,
    }),
    createPrimitiveSelectionPipelines({
      ...options,
      label: "point",
      vertexModule: options.pointVertex,
      vertexEntry: "pointVertexMain",
      primitive: "triangle-list",
      visibleFragment: selection,
      hiddenFragment: selectionTransparency,
    }),
    createPrimitiveSelectionPipelines({
      ...options,
      label: "node",
      vertexModule: options.pointVertex,
      vertexEntry: "nodeOverlayVertexMain",
      primitive: "triangle-strip",
      visibleFragment: selection,
      hiddenFragment: selectionTransparency,
      vertexBuffers: [],
    }),
  ]);
  const [triangle, line, point, node] = variants;
  return {
    trianglesSelectionVisible: triangle.visible,
    trianglesSelectionHidden: triangle.hidden,
    linesSelectionVisible: line.visible,
    linesSelectionHidden: line.hidden,
    pointsSelectionVisible: point.visible,
    pointsSelectionHidden: point.hidden,
    nodesSelectionVisible: node.visible,
    nodesSelectionHidden: node.hidden,
  };
}

async function compileSelectionFragments(
  options: SelectionPipelineOptions,
): Promise<readonly [GPUShaderModule, GPUShaderModule]> {
  const compile = (label: string, code: string) =>
    createValidatedShaderModule(options.device, label, code, options.validation);
  return Promise.all([
    compile("selection fragment", selectionFragmentShader),
    compile("selection transparency fragment", selectionTransparencyFragmentShader),
  ]);
}

async function createPrimitiveSelectionPipelines(
  options: SelectionPipelineOptions & PrimitiveSelectionOptions,
): Promise<{ readonly visible: GPURenderPipeline; readonly hidden: GPURenderPipeline }> {
  const common = selectionPipelineBase(options);
  const visible = createValidatedRenderPipeline(
    options.device,
    `${options.label} selection visible`,
    {
      ...common,
      fragment: {
        module: options.visibleFragment,
        entryPoint: "fragmentMain",
        targets: [{ format: options.format, blend: SELECTION_BLEND_STATE }],
      },
      depthStencil: {
        ...common.depthStencil,
        depthWriteEnabled: false,
        depthCompare: "less-equal",
        depthBias: -1,
      },
    },
  );
  const hidden = createValidatedRenderPipeline(
    options.device,
    `${options.label} selection hidden`,
    {
      ...common,
      fragment: {
        module: options.hiddenFragment,
        entryPoint: "fragmentMain",
        targets: [
          {
            format: TRANSPARENCY_ACCUMULATION_FORMAT,
            blend: TRANSPARENCY_ACCUMULATION_BLEND_STATE,
          },
          { format: TRANSPARENCY_REVEALAGE_FORMAT, blend: TRANSPARENCY_REVEALAGE_BLEND_STATE },
        ],
      },
      depthStencil: {
        ...common.depthStencil,
        depthWriteEnabled: false,
        depthCompare: "greater",
        stencilFront: { ...common.depthStencil.stencilFront, compare: "not-equal", passOp: "keep" },
        stencilBack: { ...common.depthStencil.stencilBack, compare: "not-equal", passOp: "keep" },
        stencilWriteMask: 0,
      },
    },
  );
  return { visible: await visible, hidden: await hidden };
}

function selectionPipelineBase(
  options: SelectionPipelineOptions & PrimitiveSelectionOptions,
): SelectionPipelineBase {
  return {
    layout: options.layout,
    vertex: {
      module: options.vertexModule,
      entryPoint: options.vertexEntry,
      buffers: options.vertexBuffers ?? [vertexLayout],
    },
    primitive: { topology: options.primitive, cullMode: "none" },
    multisample: { count: COLOR_SAMPLE_COUNT },
    depthStencil: {
      format: options.depthFormat,
      stencilFront: { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "replace" },
      stencilBack: { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "replace" },
      stencilReadMask: 2,
      stencilWriteMask: 2,
    },
  };
}
