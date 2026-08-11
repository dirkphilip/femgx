import type { WebGpuQueryOptions } from "../platform/capabilities";
import { WebGpuUnsupportedError } from "../platform/capabilities";
import { requestWebGpuDevice, watchDeviceLoss, type DeviceLostInfo } from "../platform/device";
import { createDrawResources, destroyDrawResources, type DrawResources } from "./gpu-draw";
import { createPickTargets, destroyPickTargets, type PickTargets } from "./gpu-pick";
import { createPickDepthReadback } from "./gpu-pick-depth";
import {
  createRenderResources,
  destroyRenderResources,
  type RenderResources,
} from "./gpu-pipelines";
import type { GpuValidationOptions } from "./gpu-validation";

/** Actionable message when a renderer cannot recreate an external device. */
export const EXTERNAL_DEVICE_RECOVERY_MESSAGE =
  "This renderer uses an externally provided GPU device and cannot recreate it after a loss; create a new renderer with a fresh device.";

/** Recoverable GPU resources owned by the renderer. */
export interface GpuBundle {
  device: GPUDevice;
  resources: RenderResources;
  draw: DrawResources;
  pickTargets: PickTargets;
}

/** Internal guards used while a replacement device is being assembled. */
interface RebuildGpuBundleOptions {
  readonly query?: WebGpuQueryOptions | undefined;
  readonly validation?: GpuValidationOptions | undefined;
  readonly canInstall?: () => boolean;
  readonly onCandidateLost?: (info: DeviceLostInfo) => void;
}

/** Creates the initial GPU resource bundle for a device. */
export async function createGpuBundle(
  device: GPUDevice,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  validation?: GpuValidationOptions,
): Promise<GpuBundle> {
  let resources: RenderResources | undefined;
  let draw: DrawResources | undefined;
  let pickTargets: PickTargets | undefined;
  let depthReadback: Awaited<ReturnType<typeof createPickDepthReadback>> | undefined;
  try {
    resources = await createRenderResources(device, format, depthFormat, validation);
    depthReadback = await createPickDepthReadback(device, validation);
    pickTargets = createPickTargets(depthReadback);
    draw = createDrawResources(device);
    return { device, resources, draw, pickTargets };
  } catch (error) {
    if (resources !== undefined) destroyRenderResources(resources);
    if (draw !== undefined) destroyDrawResources(draw);
    if (pickTargets !== undefined) destroyPickTargets(pickTargets);
    else if (depthReadback !== undefined) depthReadback.requestBuffer.destroy();
    throw error;
  }
}

/**
 * Re-creates the GPU device after a loss and returns a fresh resource bundle,
 * reconfiguring the canvas context for the new device. Buffers owned by the
 * lost device are already invalid and released by the browser.
 */
export async function rebuildGpuBundle(
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  options: RebuildGpuBundleOptions = {},
): Promise<GpuBundle> {
  const requested = await requestWebGpuDevice(options.query);
  if (options.canInstall !== undefined && !options.canInstall()) {
    throw new Error("WebGPU renderer was destroyed during device recovery");
  }
  let candidateLost: DeviceLostInfo | undefined;
  const unsubscribe = watchDeviceLoss(requested.device, (info) => {
    candidateLost = info;
    options.onCandidateLost?.(info);
  });
  try {
    context.configure({ device: requested.device, format, alphaMode: "opaque" });
    const bundle = await createGpuBundle(requested.device, format, depthFormat, options.validation);
    if (candidateLost !== undefined) {
      destroyGpuBundle(bundle);
      throw new Error("Replacement WebGPU device was lost during recovery");
    }
    return bundle;
  } finally {
    unsubscribe();
  }
}

/** Releases every resource owned by a completed GPU bundle. */
export function destroyGpuBundle(bundle: GpuBundle): void {
  destroyRenderResources(bundle.resources);
  destroyDrawResources(bundle.draw);
  destroyPickTargets(bundle.pickTargets);
}

/** Options for constructing a `GpuDeviceLifecycle`. */
export interface GpuDeviceLifecycleOptions {
  readonly bundle: GpuBundle;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly powerPreference: GPUPowerPreference | undefined;
  readonly validation?: GpuValidationOptions | undefined;
  /** False when the renderer uses a caller-provided device it cannot recreate. */
  readonly ownsDevice: boolean;
  readonly onLost: ((info: DeviceLostInfo) => void) | undefined;
}

/**
 * Owns the device-bound resources of a renderer, reports device loss through a
 * callback, and re-creates the device after a loss. Scene state lives in the
 * renderer and is cleared when `recover()` reports a re-creation, so the next
 * frame re-uploads everything to the fresh device.
 */
export class GpuDeviceLifecycle {
  public bundle: GpuBundle;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat: GPUTextureFormat;
  private readonly powerPreference: GPUPowerPreference | undefined;
  private readonly validation: GpuValidationOptions | undefined;
  private readonly ownsDevice: boolean;
  private readonly onLost: ((info: DeviceLostInfo) => void) | undefined;
  private state: "healthy" | "lost" | "recovering" | "destroyed" = "healthy";
  private generation = 0;
  private unsubscribeLoss: (() => void) | undefined;
  private recoveryPromise: Promise<boolean> | undefined;

  public constructor(options: GpuDeviceLifecycleOptions) {
    this.bundle = options.bundle;
    this.context = options.context;
    this.format = options.format;
    this.depthFormat = options.depthFormat;
    this.powerPreference = options.powerPreference;
    this.validation = options.validation;
    this.ownsDevice = options.ownsDevice;
    this.onLost = options.onLost;
    this.subscribe(this.bundle, this.generation);
  }

  /** True while the active lifecycle is unable to accept GPU operations. */
  public get lost(): boolean {
    return this.state !== "healthy";
  }

  /** Throws when the device is lost and `recover()` must run before drawing. */
  public ensureUsable(): void {
    if (this.state !== "healthy") {
      throw new Error(
        this.state === "destroyed"
          ? "WebGPU renderer has been destroyed"
          : "WebGPU device is lost or recovering; await recover() before using the renderer again",
      );
    }
  }

  /**
   * Re-creates the GPU device after a loss. Resolves `true` when the device was
   * re-created (the renderer must re-upload the scene); `false` as a no-op when
   * the device is healthy. Throws when the renderer uses an externally provided
   * device it cannot recreate.
   */
  public recover(): Promise<boolean> {
    if (this.state === "healthy") return Promise.resolve(false);
    if (this.state === "destroyed") {
      return Promise.reject(new Error("WebGPU renderer has been destroyed"));
    }
    if (this.recoveryPromise !== undefined) return this.recoveryPromise;
    if (!this.ownsDevice) {
      return Promise.reject(
        new WebGpuUnsupportedError("device-unavailable", EXTERNAL_DEVICE_RECOVERY_MESSAGE),
      );
    }
    this.state = "recovering";
    const query =
      this.powerPreference === undefined ? undefined : { powerPreference: this.powerPreference };
    const recovery = this.recoverOnce(query);
    this.recoveryPromise = recovery;
    recovery.then(
      () => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = undefined;
      },
      () => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = undefined;
      },
    );
    return recovery;
  }

  /** Releases the active bundle and prevents pending recovery from installing. */
  public destroy(): void {
    if (this.state === "destroyed") return;
    this.state = "destroyed";
    this.generation += 1;
    this.unsubscribeLoss?.();
    this.unsubscribeLoss = undefined;
    destroyGpuBundle(this.bundle);
  }

  private async recoverOnce(query: WebGpuQueryOptions | undefined): Promise<boolean> {
    const candidateGeneration = this.generation + 1;
    const candidateLost = { value: false };
    try {
      const bundle = await rebuildGpuBundle(this.context, this.format, this.depthFormat, {
        query,
        validation: this.validation,
        canInstall: () => this.state !== "destroyed",
        onCandidateLost: (info) => {
          candidateLost.value = true;
          this.markLost(info);
        },
      });
      if (this.state === "destroyed" || candidateLost.value) {
        destroyGpuBundle(bundle);
        if (this.state === "destroyed") {
          throw new Error("WebGPU renderer was destroyed during device recovery");
        }
        throw new Error("Replacement WebGPU device was lost during recovery");
      }
      this.unsubscribeLoss?.();
      destroyGpuBundle(this.bundle);
      this.bundle = bundle;
      this.generation = candidateGeneration;
      this.subscribe(this.bundle, this.generation);
      this.state = "healthy";
      return true;
    } catch (error) {
      if (this.state !== "destroyed") this.state = "lost";
      throw error;
    }
  }

  /** Watches one device generation and ignores stale or duplicate callbacks. */
  private subscribe(bundle: GpuBundle, generation: number): void {
    this.unsubscribeLoss = watchDeviceLoss(bundle.device, (info) => {
      if (
        this.state === "destroyed" ||
        this.state !== "healthy" ||
        generation !== this.generation ||
        bundle !== this.bundle
      ) {
        return;
      }
      this.markLost(info);
    });
  }

  private markLost(info: DeviceLostInfo): void {
    if (this.state === "destroyed" || this.state === "lost") return;
    this.state = "lost";
    this.onLost?.(info);
  }
}
