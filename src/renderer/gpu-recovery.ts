import type { WebGpuQueryOptions } from "../platform/capabilities";
import { WebGpuUnsupportedError } from "../platform/capabilities";
import { requestWebGpuDevice, watchDeviceLoss, type DeviceLostInfo } from "../platform/device";
import { createDrawResources, type DrawResources } from "./gpu-draw";
import { createPickTargets, type PickTargets } from "./gpu-pick";
import {
  configureCanvasContext,
  createRenderResources,
  type RenderResources,
} from "./gpu-pipelines";

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

/** Creates the initial GPU resource bundle for a device. */
export function createGpuBundle(
  device: GPUDevice,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): GpuBundle {
  return {
    device,
    resources: createRenderResources(device, format, depthFormat),
    draw: createDrawResources(device),
    pickTargets: createPickTargets(),
  };
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
  options?: WebGpuQueryOptions,
): Promise<GpuBundle> {
  const requested = await requestWebGpuDevice(options);
  configureCanvasContext(context, requested.device, format);
  return createGpuBundle(requested.device, format, depthFormat);
}

/** Options for constructing a `GpuDeviceLifecycle`. */
export interface GpuDeviceLifecycleOptions {
  readonly bundle: GpuBundle;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly powerPreference: GPUPowerPreference | undefined;
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
  public lost = false;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat: GPUTextureFormat;
  private readonly powerPreference: GPUPowerPreference | undefined;
  private readonly ownsDevice: boolean;
  private readonly onLost: ((info: DeviceLostInfo) => void) | undefined;

  public constructor(options: GpuDeviceLifecycleOptions) {
    this.bundle = options.bundle;
    this.context = options.context;
    this.format = options.format;
    this.depthFormat = options.depthFormat;
    this.powerPreference = options.powerPreference;
    this.ownsDevice = options.ownsDevice;
    this.onLost = options.onLost;
    this.subscribe();
  }

  /** Throws when the device is lost and `recover()` must run before drawing. */
  public ensureUsable(): void {
    if (this.lost) {
      throw new Error("WebGPU device is lost; await recover() before using the renderer again");
    }
  }

  /**
   * Re-creates the GPU device after a loss. Resolves `true` when the device was
   * re-created (the renderer must re-upload the scene); `false` as a no-op when
   * the device is healthy. Throws when the renderer uses an externally provided
   * device it cannot recreate.
   */
  public async recover(): Promise<boolean> {
    if (!this.lost) return false;
    if (!this.ownsDevice) {
      throw new WebGpuUnsupportedError("device-unavailable", EXTERNAL_DEVICE_RECOVERY_MESSAGE);
    }
    const query =
      this.powerPreference === undefined ? undefined : { powerPreference: this.powerPreference };
    this.bundle = await rebuildGpuBundle(this.context, this.format, this.depthFormat, query);
    this.subscribe();
    this.lost = false;
    return true;
  }

  /** Watches the active device so a subsequent loss is reported. */
  private subscribe(): void {
    watchDeviceLoss(this.bundle.device, (info) => {
      if (this.lost) return;
      this.lost = true;
      this.onLost?.(info);
    });
  }
}
