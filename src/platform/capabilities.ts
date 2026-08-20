/**
 * Why a WebGPU-capable path is unavailable on the current environment.
 * @category Advanced runtime and WebGPU platform
 */
export type WebGpuUnsupportedReason = "no-webgpu" | "adapter-unavailable" | "device-unavailable";

/**
 * The outcome of a WebGPU capability probe.
 * @category Advanced runtime and WebGPU platform
 */
export type WebGpuSupportStatus = "supported" | "unsupported";

/**
 * Options accepted by the capability and device probes.
 * @category Advanced runtime and WebGPU platform
 */
export interface WebGpuQueryOptions {
  /** GPU power preference; omit to let the browser pick. */
  readonly powerPreference?: GPUPowerPreference;
}

/**
 * Snapshot of the supported adapter surface reported to applications.
 * @category Advanced runtime and WebGPU platform
 */
export interface WebGpuAdapterProfile {
  /** Adapter feature names, e.g. `"depth-clip-control"`. */
  readonly features: readonly string[];
  /** Numeric adapter limits keyed by limit name, e.g. `"maxBindGroups"`. */
  readonly limits: Readonly<Record<string, number>>;
  /** Whether the user agent selected a software (fallback) adapter. */
  readonly isFallbackAdapter: boolean;
  /** Adapter-reported vendor string. */
  readonly vendor: string;
  /** Adapter-reported architecture string. */
  readonly architecture: string;
  /** Adapter-reported device string. */
  readonly device: string;
  /** Adapter-reported human-readable description. */
  readonly description: string;
}

/**
 * Non-throwing result of `queryWebGpuSupport()`.
 * @category Advanced runtime and WebGPU platform
 */
export interface WebGpuSupportReport {
  /** Whether the environment can create a supported WebGPU device. */
  readonly status: WebGpuSupportStatus;
  /** Present when `status` is `"unsupported"`. */
  readonly reason?: WebGpuUnsupportedReason;
  /** Human-readable guidance for unsupported environments. */
  readonly message: string;
  /** Adapter profile when `status` is `"supported"`. */
  readonly adapter?: WebGpuAdapterProfile;
}

/**
 * Thrown by WebGPU creation paths, carrying a typed reason for branching.
 *
 * This error describes an unsupported rendering environment; it is not an
 * invitation to select a CPU backend. Hosts can use `reason` for actionable UI
 * and `message` for user-facing guidance, then offer a WebGPU-capable browser
 * or device.
 * @category Advanced runtime and WebGPU platform
 */
export class WebGpuUnsupportedError extends Error {
  /** Typed reason why adapter or device creation was unavailable. */
  readonly reason: WebGpuUnsupportedReason;

  constructor(reason: WebGpuUnsupportedReason, message: string) {
    super(message);
    this.name = "WebGpuUnsupportedError";
    this.reason = reason;
  }
}

/**
 * Stable, actionable guidance text for each unsupported reason.
 * @category Advanced runtime and WebGPU platform
 */
export function webGpuUnsupportedMessage(reason: WebGpuUnsupportedReason): string {
  switch (reason) {
    case "no-webgpu":
      return "WebGPU is unavailable in this browser (navigator.gpu is not exposed). Use a WebGPU-capable browser; WebGPU is required for rendering.";
    case "adapter-unavailable":
      return "No WebGPU adapter is available. The browser may be running without GPU support, or WebGPU support is disabled for this machine.";
    case "device-unavailable":
      return "WebGPU device creation failed. An adapter is present but no device could be created, which usually indicates a driver or resource problem.";
  }
}

/** Returns `navigator.gpu`, or `undefined` when the environment has no WebGPU. */
function gpu(): GPU | undefined {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return undefined;
  return navigator.gpu;
}

/**
 * Requests a WebGPU adapter, throwing a typed `WebGpuUnsupportedError` when
 * the browser has no WebGPU entry point or the adapter request fails.
 *
 * This is an advanced platform-owned primitive. Most applications should use
 * {@link queryWebGpuSupport} to probe without throwing, or let
 * {@link root.createViewport} own adapter and device creation. A `null` adapter
 * means the browser exposed WebGPU but could not provide an adapter.
 * @category Advanced runtime and WebGPU platform
 */
export async function requestWebGpuAdapter(
  options?: WebGpuQueryOptions,
): Promise<GPUAdapter | null> {
  const navigatorGpu = gpu();
  if (navigatorGpu === undefined) {
    throw new WebGpuUnsupportedError("no-webgpu", webGpuUnsupportedMessage("no-webgpu"));
  }
  const adapterOptions =
    options?.powerPreference === undefined
      ? undefined
      : { powerPreference: options.powerPreference };
  try {
    return await navigatorGpu.requestAdapter(adapterOptions);
  } catch {
    throw new WebGpuUnsupportedError(
      "adapter-unavailable",
      webGpuUnsupportedMessage("adapter-unavailable"),
    );
  }
}

/** Extracts the numeric limits of an adapter into a plain record. */
function collectLimits(limits: GPUSupportedLimits): Readonly<Record<string, number>> {
  const collected: Record<string, number> = {};
  for (const [name, value] of Object.entries(limits)) {
    if (typeof value === "number") collected[name] = value;
  }
  return collected;
}

/** Captures the supported feature and limit surface of an adapter. */
function adapterProfile(adapter: GPUAdapter): WebGpuAdapterProfile {
  return {
    features: Array.from(adapter.features).sort(),
    limits: collectLimits(adapter.limits),
    isFallbackAdapter: adapter.info.isFallbackAdapter,
    vendor: adapter.info.vendor,
    architecture: adapter.info.architecture,
    device: adapter.info.device,
    description: adapter.info.description,
  };
}

/**
 * Non-throwing capability probe.
 *
 * Call this before loading a model when the host wants to gate UI or report a
 * typed unsupported reason. A supported report includes an adapter profile; an
 * unsupported report includes `reason` and actionable `message`. This probe
 * reports WebGPU capability only—it never selects a fallback renderer.
 * @example Gate the model-loading UI without throwing.
 * ```ts
 * import { queryWebGpuSupport } from "femgx";
 *
 * const support = await queryWebGpuSupport();
 * if (support.status === "unsupported") {
 *   console.warn(support.reason, support.message);
 * } else {
 *   console.log(support.adapter?.vendor);
 * }
 * ```
 * @category Advanced runtime and WebGPU platform
 */
export async function queryWebGpuSupport(
  options?: WebGpuQueryOptions,
): Promise<WebGpuSupportReport> {
  try {
    const adapter = await requestWebGpuAdapter(options);
    if (adapter === null) {
      return {
        status: "unsupported",
        reason: "adapter-unavailable",
        message: webGpuUnsupportedMessage("adapter-unavailable"),
      };
    }
    return {
      status: "supported",
      message: "WebGPU is available.",
      adapter: adapterProfile(adapter),
    };
  } catch (error) {
    if (error instanceof WebGpuUnsupportedError) {
      return { status: "unsupported", reason: error.reason, message: error.message };
    }
    return {
      status: "unsupported",
      reason: "adapter-unavailable",
      message: webGpuUnsupportedMessage("adapter-unavailable"),
    };
  }
}
