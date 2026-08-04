import { viewProjectionMatrix, type Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import { resolveInstanceStyle, type InteractionState } from "../interaction/interaction";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { Instance, PartId, PickTarget } from "../scene/types";
import {
  beginColorPass,
  createDrawResources,
  destroyDrawResources,
  drawBatches,
  encodeInstanceRecord,
  ensureDepthTexture,
  patchInstances,
  writeDrawOrder,
  type DrawCall,
  type DrawCallContext,
  type DrawResources,
  type InstanceUpdate,
} from "./gpu-draw";
import {
  beginPickPass,
  createPickTargets,
  destroyPickTargets,
  ensurePickTargets,
  readPickPixel,
  resetPickTargets,
  type PickTargets,
} from "./gpu-pick";
import {
  createRenderResources,
  destroyRenderResources,
  type RenderResources,
} from "./gpu-pipelines";
import { createDefaultInteraction, defaultStyle } from "./gpu-support";
import { buildDrawOrder, buildInstanceLayout, type InstanceLayout } from "./runtime-state";

/** Options for creating a WebGPU renderer. */
export interface WebGpuRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
}

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
  pick(x: number, y: number): Promise<PickTarget | undefined>;
  resize(width?: number, height?: number): void;
  destroy(): void;
}

/** Creates a WebGPU renderer, or throws a descriptive error when unavailable. */
export async function createWebGpuRenderer(
  options: WebGpuRendererOptions,
): Promise<WebGpuRenderer> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is unavailable in this browser");
  }
  const adapterOptions =
    options.powerPreference === undefined ? {} : { powerPreference: options.powerPreference };
  const adapter = await navigator.gpu.requestAdapter(adapterOptions);
  if (adapter === null) {
    throw new Error("WebGPU adapter request failed");
  }
  const device = options.device ?? (await adapter.requestDevice());
  return new GpuRenderer(options.canvas, device);
}

class GpuRenderer implements WebGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat = "depth24plus" as GPUTextureFormat;
  private readonly resources: RenderResources;
  private readonly pickTargets: PickTargets;
  private draw: DrawResources;
  private runtime: SceneRuntime | undefined;
  private layout: InstanceLayout | undefined;
  private calls: readonly DrawCall[] = [];
  private destroyed = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
  ) {
    const context = canvas.getContext("webgpu");
    if (context === null) throw new Error("WebGPU canvas context unavailable");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.resources = createRenderResources(device, this.format, this.depthFormat);
    this.draw = createDrawResources(device);
    this.pickTargets = createPickTargets();
    this.resize();
  }

  public render(runtime: SceneRuntime, camera: Camera, parts: ReadonlyMap<PartId, Part>): void {
    this.ensureAlive();
    this.attach(runtime);
    const viewProjection = viewProjectionMatrix(camera);
    this.device.queue.writeBuffer(this.resources.cameraBuffer, 0, new Float32Array(viewProjection));
    const encoder = this.device.createCommandEncoder();
    const colorView = this.context.getCurrentTexture().createView();
    const depthTexture = ensureDepthTexture(
      this.draw,
      this.canvas.width,
      this.canvas.height,
      this.depthFormat,
    );
    const drawContext: DrawCallContext = {
      cameraBindGroup: this.resources.cameraBindGroup,
      instanceLayout: this.resources.instanceLayout,
      parts,
    };
    const colorPass = beginColorPass(encoder, colorView, depthTexture.createView());
    drawBatches(colorPass, this.draw, drawContext, this.calls, this.resources.colorPipeline);
    colorPass.end();
    ensurePickTargets(
      this.device,
      this.pickTargets,
      this.canvas.width,
      this.canvas.height,
      this.depthFormat,
    );
    const pickPass = beginPickPass(encoder, this.pickTargets);
    drawBatches(pickPass, this.draw, drawContext, this.calls, this.resources.pickPipeline);
    pickPass.end();
    this.device.queue.submit([encoder.finish()]);
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
          resolveInstanceStyle(this.instanceFor(runtime, slot, partId), defaultStyle, interaction),
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
      patchInstances(this.draw, partId, partUpdates);
    }
    if (runtime.visibleCount !== layout.visibleCount) {
      this.rebuildVisibleOrders(runtime, layout, changedInstanceIds);
    }
  }

  public async pick(x: number, y: number): Promise<PickTarget | undefined> {
    this.ensureAlive();
    const runtime = this.runtime;
    if (runtime === undefined) return undefined;
    const pickId = await readPickPixel(this.device, this.canvas, this.pickTargets, x, y);
    const slot = pickId - 1;
    if (slot < 0 || slot >= runtime.instanceCount) return undefined;
    const partId = runtime.instancePartIds[slot];
    const instanceId = runtime.getInstanceId(slot);
    if (partId === undefined || instanceId === undefined) return undefined;
    return { kind: "instance", instanceId };
  }

  public resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight): void {
    this.canvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    resetPickTargets(this.pickTargets);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    destroyRenderResources(this.resources);
    destroyDrawResources(this.draw);
    destroyPickTargets(this.pickTargets);
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
  }

  private attach(runtime: SceneRuntime): void {
    if (
      this.runtime === runtime &&
      this.layout !== undefined &&
      this.layout.instanceCount === runtime.instanceCount
    ) {
      return;
    }
    destroyDrawResources(this.draw);
    this.draw = createDrawResources(this.device);
    const layout = buildInstanceLayout(runtime);
    const interaction = createDefaultInteraction();
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
            resolveInstanceStyle(
              this.instanceFor(runtime, slot, slotPartId),
              defaultStyle,
              interaction,
            ),
            slot + 1,
          ),
        });
      }
      patchInstances(this.draw, partId, updates);
      writeDrawOrder(this.draw, partId, buildDrawOrder(layout, runtime, partId));
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
      writeDrawOrder(this.draw, partId, order);
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

  private instanceFor(runtime: SceneRuntime, slot: number, partId: PartId): Instance {
    return {
      index: slot,
      instanceId: runtime.getInstanceId(slot) ?? String(slot),
      partId,
      worldTransform: runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
    };
  }
}
