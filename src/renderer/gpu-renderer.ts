import { requestWebGpuDevice } from "../platform/device";
import type { PartId } from "../geometry/part";
import { GpuRenderer } from "./renderer-core";
import { createGpuBundle } from "./recovery";
import { readGpuValidationOptions } from "./diagnostics/validation";
import type { WebGpuRenderer, WebGpuRendererOptions } from "./types";
import type { GpuCostSnapshot } from "./diagnostics/cost";
import type { OrientationGlyphState } from "./orientation-glyphs/orientation-glyph";
import type { ResultColorMap } from "../results/colors";
import { createGpuTimestampRecorder, type GpuTimestampSnapshot } from "./diagnostics/timestamps";

export { originTriadNominalScale } from "./overlays/origin-triad";

export type { ViewportBackground, WebGpuRenderer, WebGpuRendererOptions } from "./types";
export type { GpuCostSnapshot } from "./diagnostics/cost";
export type { GpuTimestampSnapshot } from "./diagnostics/timestamps";

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

/** Reads optional benchmark pass timestamps without widening the public renderer API. */
export function readGpuTimestampSnapshot(renderer: WebGpuRenderer): GpuTimestampSnapshot {
  if (!(renderer instanceof GpuRenderer)) {
    throw new Error("GPU timestamp accounting is unavailable for this renderer implementation");
  }
  return renderer.timestampSnapshot();
}

/** Completes only the benchmark's delayed timestamp readback pool. */
export async function drainGpuTimestampSamples(renderer: WebGpuRenderer): Promise<void> {
  if (!(renderer instanceof GpuRenderer)) {
    throw new Error("GPU timestamp accounting is unavailable for this renderer implementation");
  }
  await renderer.drainTimestampSamples();
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

/** Hands internal dense scalar colors to the concrete renderer without widening its public API. */
export function setRendererResultColors(
  renderer: WebGpuRenderer,
  colors: ResultColorMap | undefined,
): void {
  if (!(renderer instanceof GpuRenderer)) {
    throw new Error("Authored scalar colors require the built-in WebGPU renderer");
  }
  renderer.setResultColors(colors);
}

/** Creates a WebGPU renderer, or throws a typed error when unavailable. */
export async function createWebGpuRenderer(
  options: WebGpuRendererOptions,
): Promise<WebGpuRenderer> {
  return createWebGpuRendererInternal(options, false);
}

/** Creates a renderer with diagnostics requested by the opt-in benchmark only. */
export async function createWebGpuRendererInternal(
  options: WebGpuRendererOptions,
  timestampQueriesRequested: boolean,
): Promise<WebGpuRenderer> {
  const device = options.device ?? (await requestWebGpuDevice(options)).device;
  const context = options.canvas.getContext("webgpu");
  if (context === null) throw new Error("WebGPU canvas context unavailable");
  const format = navigator.gpu.getPreferredCanvasFormat();
  const depthFormat = "depth24plus-stencil8" as GPUTextureFormat;
  const validation = readGpuValidationOptions();
  const timestampRecorder = createGpuTimestampRecorder(device, timestampQueriesRequested);
  try {
    const bundle = await createGpuBundle(device, format, depthFormat, validation, {
      originTriad: options.originTriad ?? true,
    });
    return new GpuRenderer(options.canvas, options, {
      bundle,
      context,
      format,
      depthFormat,
      validation,
      timestampQueriesRequested,
      ...(timestampRecorder === undefined ? {} : { timestampRecorder }),
    });
  } catch (error) {
    timestampRecorder?.destroy();
    throw error;
  }
}
