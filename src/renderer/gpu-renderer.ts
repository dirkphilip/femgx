import { requestWebGpuDevice } from "../platform/device";
import type { PartId } from "../geometry/part";
import { GpuRenderer } from "./gpu-renderer-core";
import { createGpuBundle } from "./gpu-recovery";
import { readGpuValidationOptions } from "./core/gpu-validation";
import type { WebGpuRenderer, WebGpuRendererOptions } from "./types";
import type { GpuCostSnapshot } from "./core/gpu-cost";
import type { OrientationGlyphState } from "./orientation/gpu-orientation-glyph";

export { originTriadNominalScale } from "./helpers/gpu-origin-triad";

export type { ViewportBackground, WebGpuRenderer, WebGpuRendererOptions } from "./types";
export type { GpuCostSnapshot } from "./core/gpu-cost";

/** Reads internal renderer accounting without expanding the public renderer API. */
export function readGpuCostSnapshot(renderer: WebGpuRenderer): GpuCostSnapshot {
  if (!(renderer instanceof GpuRenderer)) {
    throw new Error("GPU cost accounting is unavailable for this renderer implementation");
  }
  return renderer.costSnapshot();
}

/** Reads internal retained edge-resource state without expanding the public renderer API. */
export function readMaterializedEdgePartIds(renderer: WebGpuRenderer): ReadonlySet<PartId> {
  if (!(renderer instanceof GpuRenderer)) {
    throw new Error("GPU edge-resource accounting is unavailable for this renderer implementation");
  }
  return renderer.materializedEdgePartIds();
}

/** Hands internal result composition to the concrete renderer without widening its public contract. */
export function setRendererOrientationGlyphs(
  renderer: WebGpuRenderer,
  state: OrientationGlyphState | undefined,
): void {
  if (!(renderer instanceof GpuRenderer)) {
    throw new Error("Elemental orientation glyphs require the built-in WebGPU renderer");
  }
  renderer.setOrientationGlyphs(state);
}

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
  const bundle = await createGpuBundle(device, format, depthFormat, validation, {
    originTriad: options.originTriad ?? true,
  });
  return new GpuRenderer(options.canvas, options, {
    bundle,
    context,
    format,
    depthFormat,
    validation,
  });
}
