import { requestWebGpuDevice } from "../platform/device";
import { GpuRenderer } from "./gpu-renderer-core";
import type { WebGpuRenderer, WebGpuRendererOptions } from "./types";

export type { WebGpuRenderer, WebGpuRendererOptions } from "./types";

/** Creates a WebGPU renderer, or throws a typed error when unavailable. */
export async function createWebGpuRenderer(
  options: WebGpuRendererOptions,
): Promise<WebGpuRenderer> {
  const device = options.device ?? (await requestWebGpuDevice(options)).device;
  return new GpuRenderer(options.canvas, device, options);
}
