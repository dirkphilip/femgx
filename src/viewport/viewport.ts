import type { DeviceLostInfo } from "../platform/device";
import { createWebGpuRenderer } from "../renderer/gpu-renderer";
import { assertPixelSize, assertViewportBackground, validateOrientationGizmo } from "./dom";
import { assertOriginTriad } from "./bounds/origin-triad";
import type { Viewport, ViewportOptions } from "./types";
import { ViewportCore } from "./core/viewport-core";
export type {
  Viewport,
  ViewportInteraction,
  ViewportOptions,
  ViewportPresentation,
  ViewportResults,
  ViewportView,
  ViewportVisibility,
  SceneUpdateOutcome,
  ViewportBackground,
  ViewportStats,
} from "./types";

/**
 * Creates a fitted, interactive FEM viewport backed only by WebGPU.
 *
 * This asynchronous factory requests the supported-path adapter/device,
 * compiles the supplied {@link root.Scene}, creates a fitted camera, installs
 * standard canvas controls and resize synchronization, and returns the sole
 * public lifecycle owner. It rejects with {@link root.WebGpuUnsupportedError} when
 * the browser cannot provide a working WebGPU device; there is no CPU renderer
 * fallback. A device loss can be reported through `onDeviceLost` and recovered
 * with {@link root.Viewport.recover}.
 * @example Create and destroy a viewport.
 * ```ts
 * import { createViewport, createPart, createSceneBuilder, identityMatrix } from "femgx";
 *
 * const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
 * if (canvas === null) throw new Error("Missing #viewport canvas");
 * const part = createPart(1, {
 *   geometries: [{
 *     primitive: "points",
 *     positions: new Float32Array([0, 0, 0]),
 *     indices: new Uint32Array([0]),
 *   }],
 * });
 * const scene = createSceneBuilder()
 *   .addPart(part)
 *   .addAssembly({
 *     id: 2,
 *     name: "root",
 *     placements: [
 *       { kind: "part", placementId: "root-part", partId: 1, transform: identityMatrix() },
 *     ],
 *   })
 *   .setRootAssembly(2)
 *   .build();
 * const viewport = await createViewport({ canvas, scene });
 * // The host removes its own event listeners before destroying the viewport.
 * viewport.destroy();
 * ```
 * @category Start here
 */
export async function createViewport(options: ViewportOptions): Promise<Viewport> {
  assertViewportBackground(options.background);
  assertOriginTriad(options.originTriad);
  assertPixelSize("pointSizePixels", options.pointSizePixels);
  assertPixelSize("nodeSizePixels", options.nodeSizePixels);
  validateOrientationGizmo(options.canvas, options.orientationGizmo);
  const owner: { viewport?: ViewportCore } = {};
  let pendingLoss: DeviceLostInfo | undefined;
  const renderer = await createWebGpuRenderer({
    canvas: options.canvas,
    ...(options.device === undefined ? {} : { device: options.device }),
    ...(options.powerPreference === undefined ? {} : { powerPreference: options.powerPreference }),
    onDeviceLost: (info) => {
      options.onDeviceLost?.(info);
      if (owner.viewport === undefined) pendingLoss = info;
      else owner.viewport.handleDeviceLoss();
    },
    ...(options.background === undefined ? {} : { background: options.background }),
    ...(options.originTriad === undefined ? {} : { originTriad: options.originTriad }),
    ...(options.pointSizePixels === undefined ? {} : { pointSizePixels: options.pointSizePixels }),
    ...(options.nodeSizePixels === undefined ? {} : { nodeSizePixels: options.nodeSizePixels }),
  });
  owner.viewport = new ViewportCore(options, renderer);
  if (pendingLoss !== undefined) owner.viewport.handleDeviceLoss();
  return owner.viewport;
}
