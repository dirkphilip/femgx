import { afterEach, describe, expect, it } from "vitest";
import {
  queryWebGpuSupport,
  requestWebGpuAdapter,
  webGpuUnsupportedMessage,
  WebGpuUnsupportedError,
  type WebGpuAdapterProfile,
} from "../../src/platform/capabilities";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

interface FakeAdapterOptions {
  readonly features?: readonly string[];
  readonly limits?: Readonly<Record<string, number>>;
  readonly info?: Partial<WebGpuAdapterProfile>;
}

function fakeAdapter(options: FakeAdapterOptions = {}): GPUAdapter {
  const {
    features = ["depth-clip-control", "float32-filterable"],
    limits = { maxBindGroups: 4, maxVertexAttributes: 16 },
    info = {},
  } = options;
  return {
    features: new Set(features),
    limits,
    info: {
      isFallbackAdapter: info.isFallbackAdapter ?? false,
      vendor: info.vendor ?? "apple",
      architecture: info.architecture ?? "arm64",
      device: info.device ?? "Apple M1",
      description: info.description ?? "fake adapter",
    },
    requestDevice: () => Promise.resolve({} as GPUDevice),
  } as unknown as GPUAdapter;
}

function installNavigator(
  gpu: {
    requestAdapter?: (options?: GPURequestAdapterOptions) => Promise<GPUAdapter | null>;
  } | null,
): void {
  const navigatorValue =
    gpu === null
      ? {}
      : {
          gpu: { requestAdapter: gpu.requestAdapter },
        };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigatorValue,
  });
}

describe("WebGPU capability probing", () => {
  it("reports no-webgpu when navigator.gpu is missing", async () => {
    installNavigator(null);
    const report = await queryWebGpuSupport();
    expect(report.status).toBe("unsupported");
    expect(report.reason).toBe("no-webgpu");
    expect(report.message).toContain("navigator.gpu");
    expect(report.adapter).toBeUndefined();
  });

  it("reports adapter-unavailable when the adapter request resolves null", async () => {
    installNavigator({ requestAdapter: () => Promise.resolve(null) });
    const report = await queryWebGpuSupport();
    expect(report.status).toBe("unsupported");
    expect(report.reason).toBe("adapter-unavailable");
    expect(report.message).toContain("adapter");
  });

  it("reports adapter-unavailable when the adapter request rejects", async () => {
    installNavigator({
      requestAdapter: () => Promise.reject(new Error("adapter probe exploded")),
    });
    const report = await queryWebGpuSupport();
    expect(report).toEqual({
      status: "unsupported",
      reason: "adapter-unavailable",
      message: webGpuUnsupportedMessage("adapter-unavailable"),
    });
  });

  it("reports supported with a sorted feature and limit profile", async () => {
    installNavigator({ requestAdapter: () => Promise.resolve(fakeAdapter()) });
    const report = await queryWebGpuSupport();
    expect(report.status).toBe("supported");
    expect(report.adapter).toEqual({
      features: ["depth-clip-control", "float32-filterable"],
      limits: { maxBindGroups: 4, maxVertexAttributes: 16 },
      isFallbackAdapter: false,
      vendor: "apple",
      architecture: "arm64",
      device: "Apple M1",
      description: "fake adapter",
    } satisfies WebGpuAdapterProfile);
  });

  it("reports the fallback adapter flag from adapter info", async () => {
    installNavigator({
      requestAdapter: () =>
        Promise.resolve(fakeAdapter({ info: { isFallbackAdapter: true, vendor: "mesa" } })),
    });
    const report = await queryWebGpuSupport();
    expect(report.status).toBe("supported");
    expect(report.adapter?.isFallbackAdapter).toBe(true);
    expect(report.adapter?.vendor).toBe("mesa");
  });

  it("swallows non-WebGpuUnsupportedError failures into adapter-unavailable", async () => {
    installNavigator({
      requestAdapter: () => {
        throw new Error("unexpected");
      },
    });
    const report = await queryWebGpuSupport();
    expect(report.reason).toBe("adapter-unavailable");
  });
});

describe("requestWebGpuAdapter", () => {
  it("throws a typed no-webgpu error when navigator.gpu is missing", async () => {
    installNavigator(null);
    await expect(requestWebGpuAdapter()).rejects.toMatchObject({ reason: "no-webgpu" });
  });

  it("passes the power preference through to requestAdapter", async () => {
    const requests: Array<GPURequestAdapterOptions | undefined> = [];
    installNavigator({
      requestAdapter: (options) => {
        requests.push(options);
        return Promise.resolve(fakeAdapter());
      },
    });
    await requestWebGpuAdapter();
    await requestWebGpuAdapter({ powerPreference: "high-performance" });
    expect(requests).toEqual([undefined, { powerPreference: "high-performance" }]);
  });

  it("returns the requested adapter", async () => {
    const adapter = fakeAdapter();
    installNavigator({ requestAdapter: () => Promise.resolve(adapter) });
    await expect(requestWebGpuAdapter()).resolves.toBe(adapter);
  });
});

describe("WebGpuUnsupportedError", () => {
  it("carries the typed reason and name", () => {
    const error = new WebGpuUnsupportedError("device-unavailable", "no device");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("WebGpuUnsupportedError");
    expect(error.reason).toBe("device-unavailable");
    expect(error.message).toBe("no device");
  });
});

describe("webGpuUnsupportedMessage", () => {
  it("explains each unsupported reason with actionable guidance", () => {
    expect(webGpuUnsupportedMessage("no-webgpu")).toContain("WebGPU-capable browser");
    expect(webGpuUnsupportedMessage("adapter-unavailable")).toContain("adapter");
    expect(webGpuUnsupportedMessage("device-unavailable")).toContain("device");
  });
});
