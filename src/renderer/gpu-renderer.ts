import type { Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import { requestWebGpuDevice } from "../platform/device";
import { resolvePickTarget } from "../picking/pick";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { PartId, PickTarget } from "../scene/types";
import { RendererAttachment } from "./attachment";
import { destroyDrawResources } from "./gpu-draw";
import { syncDeformations, validateDeformation, type DeformationState } from "./gpu-deform";
import { encodeFrame } from "./gpu-frame";
import { destroyPickTargets, readPickPixel, resetPickTargets } from "./gpu-pick";
import { destroyRenderResources } from "./gpu-pipelines";
import { createGpuBundle, GpuDeviceLifecycle } from "./gpu-recovery";

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
   * Writes the per-part element-highlight buffers for the currently emphasized
   * elements (hovered, selected, or explicitly overridden) as diffed records.
   */
  updateElements(runtime: SceneRuntime, interaction: InteractionState): void;
  /**
   * Controls whether the edge overlay culls edges occluded by nearer geometry.
   * With depth testing on (`true`, the default) the overlay compares against
   * the depth buffer; with it off edges are drawn through every surface.
   */
  setEdgeDepthTest(enabled: boolean): void;
  /**
   * Rebuilds GPU draw order after runtime visibility changed (part/assembly
   * hide-show), using the delta of affected instance slots returned by the
   * runtime. Instance records are untouched: hidden geometry is culled from the
   * draw order, so nothing is rebuilt or re-uploaded.
   */
  updateVisibility(runtime: SceneRuntime, changedInstanceIds: readonly number[]): void;
  pick(x: number, y: number): Promise<PickTarget | undefined>;
  resize(width?: number, height?: number): void;
  destroy(): void;
  /** True while the GPU device is lost and awaiting `recover()`. */
  readonly lost: boolean;
  /**
   * Re-creates the GPU device after a loss and re-uploads the scene. No-op
   * while the device is healthy. Throws when the renderer uses an externally
   * provided device that it cannot recreate.
   */
  recover(): Promise<void>;
}

/** Creates a WebGPU renderer, or throws a typed error when unavailable. */
export async function createWebGpuRenderer(
  options: WebGpuRendererOptions,
): Promise<WebGpuRenderer> {
  const device = options.device ?? (await requestWebGpuDevice(options)).device;
  return new GpuRenderer(options.canvas, device, options);
}

class GpuRenderer implements WebGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat = "depth24plus" as GPUTextureFormat;
  private readonly lifecycle: GpuDeviceLifecycle;
  private readonly pointSize: number;
  private readonly attachment = new RendererAttachment();
  private edgeDepthTest = true;
  private deformation: DeformationState | undefined;
  private destroyed = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    device: GPUDevice,
    options: WebGpuRendererOptions,
  ) {
    const context = canvas.getContext("webgpu");
    if (context === null) throw new Error("WebGPU canvas context unavailable");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.pointSize = Math.max(1, options.pointSizePixels ?? 8);
    this.lifecycle = new GpuDeviceLifecycle({
      bundle: createGpuBundle(device, this.format, this.depthFormat),
      context,
      format: this.format,
      depthFormat: this.depthFormat,
      powerPreference: options.powerPreference,
      ownsDevice: options.device === undefined,
      onLost: (info) => {
        if (!this.destroyed) options.onDeviceLost?.(info);
      },
    });
    this.resize();
  }

  public render(runtime: SceneRuntime, camera: Camera, parts: ReadonlyMap<PartId, Part>): void {
    this.ensureAlive();
    this.attachment.attach(runtime, this.lifecycle.bundle);
    syncDeformations(this.lifecycle.bundle.draw, this.deformation);
    encodeFrame(camera, parts, {
      canvas: this.canvas,
      context: this.context,
      device: this.lifecycle.bundle.device,
      draw: this.lifecycle.bundle.draw,
      resources: this.lifecycle.bundle.resources,
      calls: this.attachment.calls,
      edgeCalls: this.attachment.edgeCalls,
      pickTargets: this.lifecycle.bundle.pickTargets,
      depthFormat: this.depthFormat,
      edgeDepthTest: this.edgeDepthTest,
      pointSize: this.pointSize,
      deformation: this.deformation,
    });
  }

  public setDeformation(deformation: DeformationState): void {
    this.ensureAlive();
    validateDeformation(deformation);
    this.deformation = deformation;
  }

  public updateInstances(
    runtime: SceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void {
    this.ensureAlive();
    this.attachment.updateInstances(
      runtime,
      interaction,
      changedInstanceIds,
      this.lifecycle.bundle,
    );
  }

  public updateElements(runtime: SceneRuntime, interaction: InteractionState): void {
    this.ensureAlive();
    this.attachment.updateElements(runtime, interaction, this.lifecycle.bundle);
  }

  public setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.edgeDepthTest = enabled;
  }

  public updateVisibility(runtime: SceneRuntime, changedInstanceIds: readonly number[]): void {
    this.ensureAlive();
    this.attachment.updateVisibility(runtime, changedInstanceIds, this.lifecycle.bundle);
  }

  public async pick(x: number, y: number): Promise<PickTarget | undefined> {
    this.ensureAlive();
    if (this.attachment.runtime === undefined) return undefined;
    const { instancePickId, elementPickId } = await readPickPixel(
      this.lifecycle.bundle.device,
      this.canvas,
      this.lifecycle.bundle.pickTargets,
      x,
      y,
    );
    return resolvePickTarget(this.attachment.instances, instancePickId, elementPickId);
  }

  public resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight): void {
    this.canvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
    this.context.configure({
      device: this.lifecycle.bundle.device,
      format: this.format,
      alphaMode: "opaque",
    });
    resetPickTargets(this.lifecycle.bundle.pickTargets);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    destroyRenderResources(this.lifecycle.bundle.resources);
    destroyDrawResources(this.lifecycle.bundle.draw);
    destroyPickTargets(this.lifecycle.bundle.pickTargets);
  }

  public get lost(): boolean {
    return this.lifecycle.lost;
  }

  public async recover(): Promise<void> {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
    if (await this.lifecycle.recover()) {
      this.attachment.clear();
    }
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
    this.lifecycle.ensureUsable();
  }
}
