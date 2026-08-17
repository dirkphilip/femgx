import {
  minimalTriangleColorFragmentShader,
  minimalTriangleTransparencyFragmentShader,
  minimalTriangleVertexShader,
} from "./minimal";
import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_BLEND_STATES,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "../frame/transparency";
import { COLOR_SAMPLE_COUNT, vertexLayout } from "../resources/foundation";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

export interface MinimalPipelines {
  readonly minimalTrianglesColor: GPURenderPipeline;
  readonly minimalTrianglesTransparent: GPURenderPipeline;
}

/** Creates the camera-and-instance-only pipelines for plain triangle surfaces. */
export async function createMinimalPipelines(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation: GpuValidationOptions | undefined,
): Promise<MinimalPipelines> {
  const [vertex, color, transparency] = await Promise.all([
    createValidatedShaderModule(
      device,
      "minimal triangle vertex",
      minimalTriangleVertexShader,
      validation,
    ),
    createValidatedShaderModule(
      device,
      "minimal triangle color fragment",
      minimalTriangleColorFragmentShader,
      validation,
    ),
    createValidatedShaderModule(
      device,
      "minimal triangle transparency fragment",
      minimalTriangleTransparencyFragmentShader,
      validation,
    ),
  ]);
  const base = {
    layout,
    vertex: { module: vertex, entryPoint: "vertexMain", buffers: [vertexLayout] },
    primitive: { topology: "triangle-list" as const, cullMode: "none" as const },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "less" as const },
    multisample: { count: COLOR_SAMPLE_COUNT },
  };
  const [minimalTrianglesColor, minimalTrianglesTransparent] = await Promise.all([
    createValidatedRenderPipeline(device, "minimal triangle color", {
      ...base,
      fragment: { module: color, entryPoint: "fragmentMain", targets: [{ format }] },
    }),
    createValidatedRenderPipeline(device, "minimal triangle transparency", {
      ...base,
      fragment: {
        module: transparency,
        entryPoint: "fragmentMain",
        targets: [TRANSPARENCY_ACCUMULATION_FORMAT, TRANSPARENCY_REVEALAGE_FORMAT].map(
          (targetFormat, index) => {
            const blend = TRANSPARENCY_BLEND_STATES[index];
            return blend === undefined ? { format: targetFormat } : { format: targetFormat, blend };
          },
        ),
      },
      depthStencil: { ...base.depthStencil, depthWriteEnabled: false },
    }),
  ]);
  return { minimalTrianglesColor, minimalTrianglesTransparent };
}
