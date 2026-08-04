import type { Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { PickGranularity } from "../picking/pick";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { PartId, PickTarget } from "../scene/types";
import { RendererAttachment } from "./attachment";
import type { WebGpuRenderer, WebGpuRendererOptions } from "./gpu-renderer";
import { syncDeformations, validateDeformation, type DeformationState } from "./gpu-deform";
import { destroyDrawResources } from "./gpu-draw";
import { encodeFrame } from "./gpu-frame";
import { destroyPickTargets, pickTargetFromPixel, resetPickTargets } from "./gpu-pick";
import { destroyRenderResources } from "./gpu-pipelines";
import { createGpuBundle, GpuDeviceLifecycle } from "./gpu-recovery";

/** The WebGPU renderer implementation; see `gpu-renderer.ts` for the API. */
export class GpuRenderer implements WebGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat = "depth24plus" as GPUTextureFormat;
  private readonly lifecycle: GpuDeviceLifecycle;
  private readonly pointSize: number;
  private readonly attachment = new RendererAttachment();
  private parts = new Map<PartId, Part>();
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
    this.parts = new Map(parts);
    this.attachment.attach(runtime, this.lifecycle.bundle);
    syncDeformations(this.lifecycle.bundle.draw, this.deformation);
    encodeFrame(camera, parts, this.frameOptions());
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
    this.attachment.updateElements(runtime, interaction, this.lifecycle.bundle, this.parts);
  }

  public setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.edgeDepthTest = enabled;
  }

  public updateVisibility(runtime: SceneRuntime, changedInstanceIds: readonly number[]): void {
    this.ensureAlive();
    this.attachment.updateVisibility(runtime, changedInstanceIds, this.lifecycle.bundle);
  }

  public async pick(
    x: number,
    y: number,
    granularity?: PickGranularity,
  ): Promise<PickTarget | undefined> {
    this.ensureAlive();
    if (this.attachment.runtime === undefined) return undefined;
    return pickTargetFromPixel({
      device: this.lifecycle.bundle.device,
      canvas: this.canvas,
      pick: this.lifecycle.bundle.pickTargets,
      context: { instances: this.attachment.instances, parts: this.parts },
      x,
      y,
      granularity,
    });
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

  private frameOptions() {
    return {
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
    };
  }
}
