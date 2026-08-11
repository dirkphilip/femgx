import type { Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { PickGranularity } from "../picking/pick";
import type { DeformationState } from "../results/deform";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { PickTarget } from "../picking/types";
import { RendererAttachment } from "./attachment";
import type { WebGpuRenderer, WebGpuRendererOptions } from "./gpu-renderer";
import { syncDeformations, validateDeformation } from "./gpu-deform";
import { destroyDrawResources } from "./gpu-draw";
import { encodePickSnapshot, encodeVisibleFrame } from "./gpu-frame";
import { destroyPickTargets, pickTargetFromPixel, resetPickTargets } from "./gpu-pick";
import { displayedPointFromPixel } from "./gpu-pick-point";
import { destroyRenderResources } from "./gpu-pipelines";
import { createGpuBundle, GpuDeviceLifecycle } from "./gpu-recovery";

/** The WebGPU renderer implementation; see `gpu-renderer.ts` for the API. */
export class GpuRenderer implements WebGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat = "depth24plus-stencil8" as GPUTextureFormat;
  private readonly lifecycle: GpuDeviceLifecycle;
  private readonly pointSize: number;
  private readonly attachment = new RendererAttachment();
  private parts = new Map<PartId, Part>();
  private sourceParts: ReadonlyMap<PartId, Part> | undefined;
  private lastCamera: Camera | undefined;
  private pickSnapshotValid = false;
  private edgeDepthTest = true;
  private nodeOverlay = false;
  private orbitPivot: Vec3 | undefined;
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

  public render(
    runtime: PackedSceneRuntime,
    camera: Camera,
    parts: ReadonlyMap<PartId, Part>,
  ): void {
    this.ensureAlive();
    const partsChanged = this.sourceParts !== parts;
    const cameraChanged = this.lastCamera !== camera;
    this.sourceParts = parts;
    this.lastCamera = camera;
    this.parts = new Map(parts);
    const attachmentChanged = this.attachment.attach(runtime, this.lifecycle.bundle);
    syncDeformations(this.lifecycle.bundle.draw, this.deformation);
    if (partsChanged || cameraChanged || attachmentChanged) this.pickSnapshotValid = false;
    encodeVisibleFrame(camera, parts, this.frameOptions());
  }

  public setDeformation(deformation: DeformationState | undefined): void {
    this.ensureAlive();
    if (deformation !== undefined) validateDeformation(deformation);
    if (this.deformation !== deformation) this.pickSnapshotValid = false;
    this.deformation = deformation;
  }

  public updateInstances(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void {
    this.ensureAlive();
    if (
      this.attachment.updateInstances(
        runtime,
        interaction,
        changedInstanceIds,
        this.lifecycle.bundle,
      )
    ) {
      this.pickSnapshotValid = false;
    }
  }

  public updateElements(runtime: PackedSceneRuntime, interaction: InteractionState): void {
    this.ensureAlive();
    if (this.attachment.updateElements(runtime, interaction, this.lifecycle.bundle, this.parts)) {
      this.pickSnapshotValid = false;
    }
  }

  public setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.edgeDepthTest = enabled;
  }

  public setNodeOverlay(enabled: boolean): void {
    this.ensureAlive();
    this.nodeOverlay = enabled;
  }

  public setOrbitPivot(pivot: Vec3 | undefined): void {
    this.ensureAlive();
    this.orbitPivot = pivot;
  }

  public updateVisibility(
    runtime: PackedSceneRuntime,
    changedInstanceIds: readonly number[],
  ): void {
    this.ensureAlive();
    if (this.attachment.updateVisibility(runtime, changedInstanceIds, this.lifecycle.bundle)) {
      this.pickSnapshotValid = false;
    }
  }

  public async pick(
    x: number,
    y: number,
    granularity?: PickGranularity,
  ): Promise<PickTarget | undefined> {
    this.ensureAlive();
    if (this.attachment.runtime === undefined) return undefined;
    if (!this.ensurePickSnapshot()) return undefined;
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

  public async pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined> {
    this.ensureAlive();
    if (this.attachment.runtime === undefined) return undefined;
    if (!this.ensurePickSnapshot(camera)) return undefined;
    return displayedPointFromPixel({
      device: this.lifecycle.bundle.device,
      canvas: this.canvas,
      pick: this.lifecycle.bundle.pickTargets,
      camera,
      x,
      y,
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
    this.pickSnapshotValid = false;
  }

  public stats(): { readonly drawBatches: number } {
    this.ensureAlive();
    return { drawBatches: this.attachment.calls.length };
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

  public get device(): GPUDevice {
    return this.lifecycle.bundle.device;
  }

  public async recover(): Promise<void> {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
    if (await this.lifecycle.recover()) {
      this.attachment.clear();
      this.pickSnapshotValid = false;
    }
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
    this.lifecycle.ensureUsable();
  }

  private ensurePickSnapshot(camera = this.lastCamera): boolean {
    if (camera === undefined) return false;
    if (camera !== this.lastCamera) {
      this.lastCamera = camera;
      this.pickSnapshotValid = false;
    }
    if (!this.pickSnapshotValid) {
      syncDeformations(this.lifecycle.bundle.draw, this.deformation);
      encodePickSnapshot(camera, this.parts, this.frameOptions());
      this.pickSnapshotValid = true;
    }
    return true;
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
      colorFormat: this.format,
      depthFormat: this.depthFormat,
      edgeDepthTest: this.edgeDepthTest,
      showNodes: this.nodeOverlay,
      pointSize: this.pointSize,
      deformation: this.deformation,
      orbitPivot: this.orbitPivot,
    };
  }
}
