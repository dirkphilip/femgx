import { requestWebGpuDevice } from "../platform/device";
import { GpuRenderer } from "./gpu-renderer-core";
import { createGpuBundle } from "./gpu-recovery";
import { readGpuValidationOptions } from "./gpu-validation";
import type { WebGpuRenderer, WebGpuRendererOptions } from "./types";

export { originTriadNominalScale } from "./gpu-origin-triad";

export type { ViewportBackground, WebGpuRenderer, WebGpuRendererOptions } from "./types";

/** Creates a WebGPU renderer, or throws a typed error when unavailable. */
export async function createWebGpuRenderer(
  options: WebGpuRendererOptions,
): Promise<WebGpuRenderer> {
  const device = options.device ?? (await requestWebGpuDevice(options)).device;
  const context = options.canvas.getContext("webgpu");
  if (context === null) throw new Error("WebGPU canvas context unavailable");
  const format = navigator.gpu.getPreferredCanvasFormat();
  const depthFormat = "depth24plus-stencil8" as GPUTextureFormat;
  const validation = readGpuValidationOptions();
  const bundle = await createGpuBundle(
    device,
    format,
    depthFormat,
    validation,
    options.originTriad ?? true,
  );
  return new GpuRenderer(options.canvas, options, {
    bundle,
    context,
    format,
    depthFormat,
    validation,
  });
}
