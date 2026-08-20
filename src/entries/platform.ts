/** Supported-path WebGPU adapter, device, and capability ownership. */
export {
  queryWebGpuSupport,
  requestWebGpuAdapter,
  webGpuUnsupportedMessage,
  WebGpuUnsupportedError,
  type WebGpuAdapterProfile,
  type WebGpuQueryOptions,
  type WebGpuSupportReport,
  type WebGpuSupportStatus,
  type WebGpuUnsupportedReason,
} from "../platform/capabilities";
export {
  requestWebGpuDevice,
  type DeviceLostInfo,
  type RequestedWebGpuDevice,
} from "../platform/device";
