import { viewProjectionMatrix, type Camera } from "../camera/camera";
import type { InteractionState } from "../interaction/interaction";
import { instanceToTarget } from "../picking/pick";
import { compileScene } from "../runtime/compile";
import type { Scene } from "../scene/scene";
import type { Instance, PickTarget } from "../scene/types";
import {
  createDrawResources,
  destroyDrawResources,
  beginColorPass,
  ensureDepthTexture,
  drawBatches,
  type DrawCallContext,
  type DrawResources,
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
import { createDefaultInteraction } from "./gpu-support";

/** Options for creating a WebGPU renderer. */
export interface WebGpuRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
}

/** A renderer that uploads each part once and draws visible instances in batches. */
export interface WebGpuRenderer {
  render(scene: Scene, camera: Camera, interaction?: InteractionState): void;
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
  private readonly draw: DrawResources;
  private readonly pickTargets: PickTargets;
  private lastInstances: readonly Instance[] = [];
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

  public render(scene: Scene, camera: Camera, interaction = createDefaultInteraction()): void {
    this.ensureAlive();
    const viewProjection = viewProjectionMatrix(camera);
    const compiled = compileScene(scene, { viewProjection });
    this.lastInstances = compiled.instances;
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
      parts: scene.parts,
      interaction,
    };
    const colorPass = beginColorPass(encoder, colorView, depthTexture.createView());
    drawBatches(colorPass, this.draw, drawContext, compiled.batches, this.resources.colorPipeline);
    colorPass.end();
    ensurePickTargets(
      this.device,
      this.pickTargets,
      this.canvas.width,
      this.canvas.height,
      this.depthFormat,
    );
    const pickPass = beginPickPass(encoder, this.pickTargets);
    drawBatches(pickPass, this.draw, drawContext, compiled.batches, this.resources.pickPipeline);
    pickPass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  public async pick(x: number, y: number): Promise<PickTarget | undefined> {
    this.ensureAlive();
    const pickId = await readPickPixel(this.device, this.canvas, this.pickTargets, x, y);
    const instance = pickId === 0 ? undefined : this.lastInstances[pickId - 1];
    return instance === undefined ? undefined : instanceToTarget(instance, false);
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
}
