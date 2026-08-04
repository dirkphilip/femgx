import type { Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import { requestWebGpuDevice } from "../platform/device";
import { resolvePickTarget } from "../picking/pick";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { Instance, InstanceId, PartId, PickTarget } from "../scene/types";
import { syncElementHighlights } from "./gpu-elements";
import {
  createDrawResources,
  destroyDrawResources,
  patchInstances,
  writeDrawOrder,
  writeEdgeOrder,
  type DrawCall,
} from "./gpu-draw";
import { encodeFrame } from "./gpu-frame";
import { destroyPickTargets, readPickPixel, resetPickTargets } from "./gpu-pick";
import { destroyRenderResources } from "./gpu-pipelines";
import { createGpuBundle, GpuDeviceLifecycle } from "./gpu-recovery";
import { collectInstanceUpdates } from "./instance-updates";
import {
  buildDrawOrder,
  buildEdgeOrder,
  buildInstanceLayout,
  buildInstanceSnapshot,
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
  private runtime: SceneRuntime | undefined;
  private layout: InstanceLayout | undefined;
  private calls: readonly DrawCall[] = [];
  private edgeCalls: readonly DrawCall[] = [];
  private instances: Instance[] = [];
  private slotByInstanceId = new Map<InstanceId, number>();
  private edgeFlags: boolean[] = [];
  private edgeDepthTest = true;
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
    this.attach(runtime);
    encodeFrame(camera, parts, {
      canvas: this.canvas,
      context: this.context,
      device: this.lifecycle.bundle.device,
      draw: this.lifecycle.bundle.draw,
      resources: this.lifecycle.bundle.resources,
      calls: this.calls,
      edgeCalls: this.edgeCalls,
      pickTargets: this.lifecycle.bundle.pickTargets,
      depthFormat: this.depthFormat,
      edgeDepthTest: this.edgeDepthTest,
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
    const { updates, edgeChanged } = collectInstanceUpdates(
      runtime,
      layout,
      interaction,
      this.edgeFlags,
      changedInstanceIds,
    );
    for (const [partId, partUpdates] of updates) {
      patchInstances(this.lifecycle.bundle.draw, partId, partUpdates);
    }
    if (edgeChanged.size > 0) {
      this.rebuildEdgeOrders(runtime, layout, edgeChanged);
    }
    if (runtime.visibleCount !== layout.visibleCount) {
      this.rebuildVisibleOrders(runtime, layout, changedInstanceIds);
    } else if (edgeChanged.size > 0) {
      this.rebuildCalls();
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

  public setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.edgeDepthTest = enabled;
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
      this.runtime = this.layout = undefined;
      this.calls = this.edgeCalls = [];
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
    const snapshot = buildInstanceSnapshot(runtime);
    this.instances = snapshot.instances;
    this.slotByInstanceId = snapshot.slotByInstanceId;
    this.edgeFlags = new Array<boolean>(runtime.instanceCount).fill(false);
    const allSlots = Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
    const { updates } = collectInstanceUpdates(
      runtime,
      layout,
      createInteractionState(),
      this.edgeFlags,
      allSlots,
    );
    for (const [partId, partUpdates] of updates) {
      patchInstances(this.lifecycle.bundle.draw, partId, partUpdates);
    }
    for (const partId of layout.partOrder) {
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
    this.rebuildEdgeOrders(runtime, layout, rebuild);
    layout.visibleCount = runtime.visibleCount;
    this.rebuildCalls();
  }

  private rebuildEdgeOrders(
    runtime: SceneRuntime,
    layout: InstanceLayout,
    parts: ReadonlySet<PartId>,
  ): void {
    for (const partId of parts) {
      const order = buildEdgeOrder(layout, runtime, partId, this.edgeFlags);
      writeEdgeOrder(this.lifecycle.bundle.draw, partId, order);
      layout.partEdgeCounts.set(partId, order.length);
    }
  }

  private rebuildCalls(): void {
    const layout = this.layout;
    if (layout === undefined) {
      this.calls = [];
      this.edgeCalls = [];
      return;
    }
    const calls: DrawCall[] = [];
    const edgeCalls: DrawCall[] = [];
    for (const partId of layout.partOrder) {
      const count = layout.partVisibleCounts.get(partId);
      if (count !== undefined && count > 0) {
        calls.push({ partId, instanceCount: count });
      }
      const edgeCount = layout.partEdgeCounts.get(partId);
      if (edgeCount !== undefined && edgeCount > 0) {
        edgeCalls.push({ partId, instanceCount: edgeCount });
      }
    }
    this.calls = calls;
    this.edgeCalls = edgeCalls;
  }
}
