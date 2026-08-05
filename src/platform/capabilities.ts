/** Why a WebGPU-capable path is unavailable on the current environment. */
export type WebGpuUnsupportedReason = "no-webgpu" | "adapter-unavailable" | "device-unavailable";

/** The outcome of a WebGPU capability probe. */
export type WebGpuSupportStatus = "supported" | "unsupported";

/** Options accepted by the capability and device probes. */
export interface WebGpuQueryOptions {
  /** GPU power preference; omit to let the browser pick. */
  readonly powerPreference?: GPUPowerPreference;
}

/** Snapshot of the supported adapter surface reported to applications. */
export interface WebGpuAdapterProfile {
  /** Adapter feature names, e.g. `"depth-clip-control"`. */
  readonly features: readonly string[];
  /** Numeric adapter limits keyed by limit name, e.g. `"maxBindGroups"`. */
  readonly limits: Readonly<Record<string, number>>;
  /** Whether the user agent selected a software (fallback) adapter. */
  readonly isFallbackAdapter: boolean;
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

/** Non-throwing result of `queryWebGpuSupport()`. */
export interface WebGpuSupportReport {
  readonly status: WebGpuSupportStatus;
  /** Present when `status` is `"unsupported"`. */
  readonly reason?: WebGpuUnsupportedReason;
  /** Human-readable guidance for unsupported environments. */
  readonly message: string;
  /** Adapter profile when `status` is `"supported"`. */
  readonly adapter?: WebGpuAdapterProfile;
}

/** Thrown by WebGPU creation paths, carrying a typed reason for branching. */
export class WebGpuUnsupportedError extends Error {
  readonly reason: WebGpuUnsupportedReason;

  constructor(reason: WebGpuUnsupportedReason, message: string) {
    super(message);
    this.name = "WebGpuUnsupportedError";
    this.reason = reason;
  }
}

/** Stable, actionable guidance text for each unsupported reason. */
export function unsupportedMessage(reason: WebGpuUnsupportedReason): string {
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
 */
export async function requestWebGpuAdapter(
  options?: WebGpuQueryOptions,
): Promise<GPUAdapter | null> {
  const navigatorGpu = gpu();
  if (navigatorGpu === undefined) {
    throw new WebGpuUnsupportedError("no-webgpu", unsupportedMessage("no-webgpu"));
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
      unsupportedMessage("adapter-unavailable"),
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
 * Non-throwing capability probe. Applications call this before loading a model
 * to decide whether WebGPU rendering is available and what the adapter offers.
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
        message: unsupportedMessage("adapter-unavailable"),
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
      message: unsupportedMessage("adapter-unavailable"),
    };
  }
}
