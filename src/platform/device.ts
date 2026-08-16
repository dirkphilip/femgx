import { requestWebGpuAdapter, WebGpuUnsupportedError, unsupportedMessage } from "./capabilities";
import type { WebGpuQueryOptions } from "./capabilities";

/**
 * A WebGPU adapter/device pair returned by `requestWebGpuDevice()`.
 * @category Advanced runtime and WebGPU platform
 */
export interface RequestedWebGpuDevice {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
}

/**
 * Requests an adapter and a device, throwing a typed `WebGpuUnsupportedError`
 * that explains *why* WebGPU is unavailable when creation fails.
 *
 * This is the explicit platform-ownership path for hosts that need the raw
 * `GPUDevice`. The canonical application path is {@link root.createFemViewport},
 * which owns the device lifecycle and recovery. A failed device request is a
 * typed unsupported result, never permission to construct a CPU renderer.
 * @category Advanced runtime and WebGPU platform
 */
export async function requestWebGpuDevice(
  options?: WebGpuQueryOptions,
): Promise<RequestedWebGpuDevice> {
  const adapter = await requestWebGpuAdapter(options);
  if (adapter === null) {
    throw new WebGpuUnsupportedError(
      "adapter-unavailable",
      unsupportedMessage("adapter-unavailable"),
    );
  }
  try {
    const device = await adapter.requestDevice();
    return { adapter, device };
  } catch {
    throw new WebGpuUnsupportedError(
      "device-unavailable",
      unsupportedMessage("device-unavailable"),
    );
  }
}

/**
 * Typed summary of a GPU device loss.
 * @category Advanced runtime and WebGPU platform
 */
export interface DeviceLostInfo {
  /** `"destroyed"` when the device was destroyed, otherwise `"unknown"`. */
  readonly reason: GPUDeviceLostReason;
  readonly message: string;
}

/**
 * Subscribes to a device's `lost` promise and reports the loss through the
 * callback. Returns a disposer so stale generations can be detached before a
 * replacement device is installed.
 */
export function watchDeviceLoss(
  device: GPUDevice,
  onLost: (info: DeviceLostInfo) => void,
): () => void {
  let active = true;
  void device.lost.then(
    (info) => {
      if (active) onLost({ reason: info.reason, message: info.message });
    },
    () => {
      if (active)
        onLost({ reason: "unknown", message: "WebGPU device lost with an unknown error" });
    },
  );
  return () => {
    active = false;
  };
}
