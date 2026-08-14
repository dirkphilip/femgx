import {
  orientationGlyphColorFragmentShader,
  orientationGlyphTransparencyFragmentShader,
  orientationGlyphVertexShader,
} from "./gpu-orientation-glyph-shader";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "./gpu-validation";
import { COLOR_SAMPLE_COUNT } from "./gpu-support";
import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_ACCUMULATION_BLEND_STATE,
  TRANSPARENCY_REVEALAGE_BLEND_STATE,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "./gpu-transparency";

/** Pipelines and bind-group layouts for the renderer-owned glyph passes. */
export interface OrientationGlyphPipelines {
  readonly instanceLayout: GPUBindGroupLayout;
  readonly layout: GPUBindGroupLayout;
  readonly visible: GPURenderPipeline;
  readonly hidden: GPURenderPipeline;
}

interface OrientationGlyphPipelineOptions {
  readonly device: GPUDevice;
  readonly cameraLayout: GPUBindGroupLayout;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly validation?: GpuValidationOptions;
}

interface OrientationGlyphShaders {
  readonly vertex: GPUShaderModule;
  readonly visibleFragment: GPUShaderModule;
  readonly hiddenFragment: GPUShaderModule;
}

/** Creates the glyph pipeline layout and visible/occluded render pipelines. */
export async function createOrientationGlyphPipelines(
  options: OrientationGlyphPipelineOptions,
): Promise<OrientationGlyphPipelines> {
  const instanceLayout = createOrientationGlyphInstanceLayout(options.device);
  const layout = createOrientationGlyphLayout(options.device);
  const pipelineLayout = options.device.createPipelineLayout({
    bindGroupLayouts: [options.cameraLayout, instanceLayout, layout],
  });
  const shaders = await createOrientationGlyphShaders(options);
  const [visible, hidden] = await Promise.all([
    createVisibleGlyphPipeline(options, pipelineLayout, shaders),
    createHiddenGlyphPipeline(options, pipelineLayout, shaders),
  ]);
  return { instanceLayout, layout, visible, hidden };
}

function createOrientationGlyphLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
}

function createOrientationGlyphInstanceLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
    ],
  });
}

async function createOrientationGlyphShaders(
  options: OrientationGlyphPipelineOptions,
): Promise<OrientationGlyphShaders> {
  const { device, validation } = options;
  const [vertex, visibleFragment, hiddenFragment] = await Promise.all([
    createValidatedShaderModule(
      device,
      "orientation glyph vertex",
      orientationGlyphVertexShader,
      validation,
    ),
    createValidatedShaderModule(
      device,
      "orientation glyph visible fragment",
      orientationGlyphColorFragmentShader,
      validation,
    ),
    createValidatedShaderModule(
      device,
      "orientation glyph hidden fragment",
      orientationGlyphTransparencyFragmentShader,
      validation,
    ),
  ]);
  return { vertex, visibleFragment, hiddenFragment };
}

function createVisibleGlyphPipeline(
  options: OrientationGlyphPipelineOptions,
  layout: GPUPipelineLayout,
  shaders: OrientationGlyphShaders,
): Promise<GPURenderPipeline> {
  return createValidatedRenderPipeline(options.device, "orientation glyph visible", {
    layout,
    vertex: { module: shaders.vertex, entryPoint: "vertexMain" },
    fragment: {
      module: shaders.visibleFragment,
      entryPoint: "fragmentMain",
      targets: [{ format: options.format }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: options.depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: COLOR_SAMPLE_COUNT },
  });
}

function createHiddenGlyphPipeline(
  options: OrientationGlyphPipelineOptions,
  layout: GPUPipelineLayout,
  shaders: OrientationGlyphShaders,
): Promise<GPURenderPipeline> {
  return createValidatedRenderPipeline(options.device, "orientation glyph hidden", {
    layout,
    vertex: { module: shaders.vertex, entryPoint: "vertexMain" },
    fragment: {
      module: shaders.hiddenFragment,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: TRANSPARENCY_ACCUMULATION_FORMAT,
          blend: TRANSPARENCY_ACCUMULATION_BLEND_STATE,
        },
        { format: TRANSPARENCY_REVEALAGE_FORMAT, blend: TRANSPARENCY_REVEALAGE_BLEND_STATE },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: options.depthFormat,
      depthWriteEnabled: false,
      depthCompare: "greater",
    },
    multisample: { count: COLOR_SAMPLE_COUNT },
  });
}
