import type { Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import { requestWebGpuDevice } from "../platform/device";
import type { PickGranularity } from "../picking/pick";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { PartId, PickTarget } from "../scene/types";
import type { DeformationState } from "./gpu-deform";
import { GpuRenderer } from "./gpu-renderer-core";

/** Options for creating a WebGPU renderer. */
export interface WebGpuRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
  /** Screen-space diameter of point elements in device pixels (default 8). */
  readonly pointSizePixels?: number;
  /** Called with a typed reason when the underlying GPU device is lost. */
  readonly onDeviceLost?: (info: DeviceLostInfo) => void;
}

/**
 * A renderer that draws a packed scene runtime with stable per-part instance
 * buffers. Instance records are patched in place as subrange writes; hidden
 * instances are removed from per-part draw-order lists so only visible
 * geometry is ever drawn. The edge overlay draws the line edges of the visible
 * instances whose resolved style requests them, through a second compacted
 * draw-order list.
 */
export interface WebGpuRenderer {
  render(runtime: SceneRuntime, camera: Camera, parts: ReadonlyMap<PartId, Part>): void;
  /**
   * Sets the per-frame deformation state (displacement scale + active load
   * case) and the per-part nodal displacement buffers that displace vertices on
   * the GPU. Buffers are uploaded once and reused until the array reference
   * changes; the uniform is rewritten each frame.
   */
  setDeformation(deformation: DeformationState): void;
  /**
   * Writes only the GPU subranges affected by changed instance slots, applying
   * the given interaction state (transform, style, and pick attributes).
   */
  updateInstances(
    runtime: SceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void;
  /**
   * Writes the per-part emphasis buffers for the currently emphasized
   * elements, faces, and nodes (hovered, selected, or explicitly overridden)
   * as diffed records.
   */
  updateElements(runtime: SceneRuntime, interaction: InteractionState): void;
  /**
   * Controls whether the edge overlay culls edges occluded by nearer geometry.
   * With depth testing on (`true`, the default) the overlay compares against
   * the depth buffer; with it off edges are drawn through every surface.
   */
  setEdgeDepthTest(enabled: boolean): void;
  /** Controls the screen-space glyphs for finite-element nodes. */
  setNodeOverlay(enabled: boolean): void;
  /**
   * Rebuilds GPU draw order after runtime visibility changed (part/assembly
   * hide-show), using the delta of affected instance slots returned by the
   * runtime. Instance records are untouched: hidden geometry is culled from the
   * draw order, so nothing is rebuilt or re-uploaded.
   */
  updateVisibility(runtime: SceneRuntime, changedInstanceIds: readonly number[]): void;
  /**
   * Picks the most specific target under a pixel, or a target at an explicit
   * granularity (see {@link PickGranularity}).
   *
   * `x`/`y` are CSS pixels relative to the canvas element's top-left
   * (`clientX - rect.left`, `clientY - rect.top`); the renderer maps them onto
   * the device buffer via the canvas bounding rect.
   */
  pick(x: number, y: number, granularity?: PickGranularity): Promise<PickTarget | undefined>;
  resize(width?: number, height?: number): void;
  destroy(): void;
  /** Number of surface draw batches encoded per frame. */
  stats(): { readonly drawBatches: number };
  /** True while the GPU device is lost and awaiting `recover()`. */
  readonly lost: boolean;
  /**
   * Re-creates the GPU device after a loss and re-uploads the scene. No-op
   * while the device is healthy. Throws when the renderer uses an externally
   * provided device that it cannot recreate.
   */
  recover(): Promise<void>;
  /** The GPU device backing the renderer; replaced by a fresh device on recovery. */
  readonly device: GPUDevice;
}

/** Creates a WebGPU renderer, or throws a typed error when unavailable. */
export async function createWebGpuRenderer(
  options: WebGpuRendererOptions,
): Promise<WebGpuRenderer> {
  const device = options.device ?? (await requestWebGpuDevice(options)).device;
  return new GpuRenderer(options.canvas, device, options);
}
