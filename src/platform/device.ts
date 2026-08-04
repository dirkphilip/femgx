import { requestWebGpuAdapter, WebGpuUnsupportedError, unsupportedMessage } from "./capabilities";
import type { WebGpuQueryOptions } from "./capabilities";

/** A WebGPU adapter/device pair returned by `requestWebGpuDevice()`. */
export interface RequestedWebGpuDevice {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
}

/**
 * Requests an adapter and a device, throwing a typed `WebGpuUnsupportedError`
 * that explains *why* WebGPU is unavailable when creation fails.
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

/** Typed summary of a GPU device loss. */
export interface DeviceLostInfo {
  /** `"destroyed"` when the device was destroyed, otherwise `"unknown"`. */
  readonly reason: GPUDeviceLostReason;
  readonly message: string;
}

/**
 * Subscribes to a device's `lost` promise and reports the loss through the
 * callback. The subscription lives for the lifetime of the device, so the
 * callback must be idempotent.
 */
export function watchDeviceLoss(device: GPUDevice, onLost: (info: DeviceLostInfo) => void): void {
  void device.lost.then(
    (info) => {
      onLost({ reason: info.reason, message: info.message });
    },
    () => {
      onLost({ reason: "unknown", message: "WebGPU device lost with an unknown error" });
    },
  );
}
