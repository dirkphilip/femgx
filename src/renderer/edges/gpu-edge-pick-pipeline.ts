import { edgePickFragmentShader, edgePickVertexShader } from "./gpu-edge-pick";
import { PICK_TEXTURE_FORMAT } from "../picking/pick-format";
import { vertexLayout } from "../resources/gpu-support";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../core/gpu-validation";

/** Creates the optional authored-edge pick pipeline on first edge request. */
export async function createEdgePickPipeline(options: {
  readonly device: GPUDevice;
  readonly layout: GPUPipelineLayout;
  readonly depthFormat: GPUTextureFormat;
  readonly validation?: GpuValidationOptions;
}): Promise<GPURenderPipeline> {
  const [vertexModule, fragmentModule] = await Promise.all([
    createValidatedShaderModule(
      options.device,
      "authored edge pick vertex",
      edgePickVertexShader,
      options.validation,
    ),
    createValidatedShaderModule(
      options.device,
      "authored edge pick fragment",
      edgePickFragmentShader,
      options.validation,
    ),
  ]);
  return createValidatedRenderPipeline(options.device, "authored edge pick", {
    layout: options.layout,
    vertex: { module: vertexModule, entryPoint: "vertexMain", buffers: [vertexLayout] },
    fragment: {
      module: fragmentModule,
      entryPoint: "fragmentMain",
      targets: [{ format: PICK_TEXTURE_FORMAT }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: options.depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: 1 },
  });
}
