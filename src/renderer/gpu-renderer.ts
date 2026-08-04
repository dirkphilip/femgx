import type { Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import { resolveInstanceStyle, type InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import { requestWebGpuDevice } from "../platform/device";
import { resolvePickTarget } from "../picking/pick";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { Instance, InstanceId, PartId, PickTarget } from "../scene/types";
import { syncElementHighlights } from "./gpu-elements";
import {
  createDrawResources,
  destroyDrawResources,
  encodeInstanceRecord,
  patchInstances,
  writeDrawOrder,
  type DrawCall,
  type InstanceUpdate,
} from "./gpu-draw";
import { encodeFrame, type DisplayMode } from "./gpu-frame";
import { destroyPickTargets, readPickPixel, resetPickTargets } from "./gpu-pick";
import { destroyRenderResources } from "./gpu-pipelines";
import { createDefaultInteraction, defaultStyle } from "./gpu-support";
import { createGpuBundle, GpuDeviceLifecycle } from "./gpu-recovery";
import {
  buildDrawOrder,
  buildInstanceLayout,
  buildInstanceSnapshot,
  instanceAt,
  type InstanceLayout,
} from "./runtime-state";

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

/** How the visible color pass renders each part. */
export type { DisplayMode } from "./gpu-frame";

/**
 * A renderer that draws a packed scene runtime with stable per-part instance
 * buffers. Instance records are patched in place as subrange writes; hidden
 * instances are removed from per-part draw-order lists so only visible
 * geometry is ever drawn.
 */
export interface WebGpuRenderer {
  render(runtime: SceneRuntime, camera: Camera, parts: ReadonlyMap<PartId, Part>): void;
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
  /** Sets whether the color pass also draws the wireframe edge overlay. */
  setDisplayMode(mode: DisplayMode): void;
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
  const query =
    options.powerPreference === undefined
      ? undefined
      : { powerPreference: options.powerPreference };
  const device = options.device ?? (await requestWebGpuDevice(query)).device;
  return new GpuRenderer(
    options.canvas,
    device,
    options.powerPreference,
    options.device === undefined,
    options.onDeviceLost,
    options.pointSizePixels ?? 8,
  );
}

class GpuRenderer implements WebGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat = "depth24plus" as GPUTextureFormat;
  private readonly lifecycle: GpuDeviceLifecycle;
  private readonly pointSize: number;
  private runtime: SceneRuntime | undefined;
  private layout: InstanceLayout | undefined;
  private calls: readonly DrawCall[] = [];
  private instances: Instance[] = [];
  private slotByInstanceId = new Map<InstanceId, number>();
  private displayMode: DisplayMode = "solid";
  private destroyed = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    device: GPUDevice,
    powerPreference: GPUPowerPreference | undefined,
    ownsDevice: boolean,
    onDeviceLost: ((info: DeviceLostInfo) => void) | undefined,
    pointSize: number,
  ) {
    const context = canvas.getContext("webgpu");
    if (context === null) throw new Error("WebGPU canvas context unavailable");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.pointSize = Math.max(1, pointSize);
    this.lifecycle = new GpuDeviceLifecycle({
      bundle: createGpuBundle(device, this.format, this.depthFormat),
      context,
      format: this.format,
      depthFormat: this.depthFormat,
      powerPreference,
      ownsDevice,
      onLost: (info) => {
        if (!this.destroyed) onDeviceLost?.(info);
      },
    });
    this.resize();
  }

  public render(runtime: SceneRuntime, camera: Camera, parts: ReadonlyMap<PartId, Part>): void {
    this.ensureAlive();
    this.attach(runtime);
    encodeFrame(camera, parts, {
      canvas: this.canvas,
      context: this.context,
      device: this.lifecycle.bundle.device,
      draw: this.lifecycle.bundle.draw,
      resources: this.lifecycle.bundle.resources,
      calls: this.calls,
      pickTargets: this.lifecycle.bundle.pickTargets,
      depthFormat: this.depthFormat,
      displayMode: this.displayMode,
      pointSize: this.pointSize,
    });
  }

  public updateInstances(
    runtime: SceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void {
    this.ensureAlive();
    this.attach(runtime);
    const layout = this.layout;
    if (layout === undefined) return;
    const updates = new Map<PartId, InstanceUpdate[]>();
    for (const slot of changedInstanceIds) {
      if (slot < 0 || slot >= runtime.instanceCount) continue;
      const partId = runtime.instancePartIds[slot];
      const local = layout.slotPartLocal[slot];
      if (partId === undefined || local === undefined || local < 0) continue;
      const update: InstanceUpdate = {
        slot: local,
        data: encodeInstanceRecord(
          runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
          resolveInstanceStyle(instanceAt(runtime, slot, partId), defaultStyle, interaction),
          slot + 1,
        ),
      };
      const list = updates.get(partId);
      if (list === undefined) {
        updates.set(partId, [update]);
      } else {
        list.push(update);
      }
    }
    for (const [partId, partUpdates] of updates) {
      patchInstances(this.lifecycle.bundle.draw, partId, partUpdates);
    }
    if (runtime.visibleCount !== layout.visibleCount) {
      this.rebuildVisibleOrders(runtime, layout, changedInstanceIds);
    }
  }

  public updateElements(runtime: SceneRuntime, interaction: InteractionState): void {
    this.ensureAlive();
    this.attach(runtime);
    const layout = this.layout;
    if (layout === undefined) return;
    syncElementHighlights(
      {
        device: this.lifecycle.bundle.device,
        draw: this.lifecycle.bundle.draw,
        runtime,
        layout,
        slotByInstanceId: this.slotByInstanceId,
      },
      interaction,
    );
  }

  public setDisplayMode(mode: DisplayMode): void {
    this.ensureAlive();
    this.displayMode = mode;
  }

  public updateVisibility(runtime: SceneRuntime, changedInstanceIds: readonly number[]): void {
    this.ensureAlive();
    this.attach(runtime);
    const layout = this.layout;
    if (layout === undefined) return;
    this.rebuildVisibleOrders(runtime, layout, changedInstanceIds);
  }

  public async pick(x: number, y: number): Promise<PickTarget | undefined> {
    this.ensureAlive();
    const runtime = this.runtime;
    if (runtime === undefined) return undefined;
    const { instancePickId, elementPickId } = await readPickPixel(
      this.lifecycle.bundle.device,
      this.canvas,
      this.lifecycle.bundle.pickTargets,
      x,
      y,
    );
    return resolvePickTarget(this.instances, instancePickId, elementPickId);
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
      this.runtime = undefined;
      this.layout = undefined;
      this.calls = [];
    }
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
    this.lifecycle.ensureUsable();
  }

  private attach(runtime: SceneRuntime): void {
    if (
      this.runtime === runtime &&
      this.layout !== undefined &&
      this.layout.instanceCount === runtime.instanceCount
    ) {
      return;
    }
    destroyDrawResources(this.lifecycle.bundle.draw);
    this.lifecycle.bundle.draw = createDrawResources(this.lifecycle.bundle.device);
    const layout = buildInstanceLayout(runtime);
    const interaction = createDefaultInteraction();
    const snapshot = buildInstanceSnapshot(runtime);
    this.instances = snapshot.instances;
    this.slotByInstanceId = snapshot.slotByInstanceId;
    for (const partId of layout.partOrder) {
      const slots = layout.partSlots.get(partId);
      if (slots === undefined) continue;
      const updates: InstanceUpdate[] = [];
      for (const slot of slots) {
        const local = layout.slotPartLocal[slot];
        const slotPartId = runtime.instancePartIds[slot];
        if (local === undefined || local < 0 || slotPartId === undefined) continue;
        updates.push({
          slot: local,
          data: encodeInstanceRecord(
            runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
            resolveInstanceStyle(instanceAt(runtime, slot, slotPartId), defaultStyle, interaction),
            slot + 1,
          ),
        });
      }
      patchInstances(this.lifecycle.bundle.draw, partId, updates);
      writeDrawOrder(this.lifecycle.bundle.draw, partId, buildDrawOrder(layout, runtime, partId));
    }
    this.runtime = runtime;
    this.layout = layout;
    this.rebuildCalls();
  }

  private rebuildVisibleOrders(
    runtime: SceneRuntime,
    layout: InstanceLayout,
    changedInstanceIds: readonly number[],
  ): void {
    const affected = new Set<PartId>();
    for (const slot of changedInstanceIds) {
      if (slot < 0 || slot >= runtime.instanceCount) continue;
      const partId = runtime.instancePartIds[slot];
      if (partId !== undefined) affected.add(partId);
    }
    const rebuild = affected.size > 0 ? affected : new Set(layout.partOrder);
    for (const partId of rebuild) {
      const order = buildDrawOrder(layout, runtime, partId);
      writeDrawOrder(this.lifecycle.bundle.draw, partId, order);
      layout.partVisibleCounts.set(partId, order.length);
    }
    layout.visibleCount = runtime.visibleCount;
    this.rebuildCalls();
  }

  private rebuildCalls(): void {
    const layout = this.layout;
    if (layout === undefined) {
      this.calls = [];
      return;
    }
    const calls: DrawCall[] = [];
    for (const partId of layout.partOrder) {
      const count = layout.partVisibleCounts.get(partId);
      if (count !== undefined && count > 0) {
        calls.push({ partId, instanceCount: count });
      }
    }
    this.calls = calls;
  }
}
