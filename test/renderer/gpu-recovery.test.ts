import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGpuBundle,
  EXTERNAL_DEVICE_RECOVERY_MESSAGE,
  GpuDeviceLifecycle,
  rebuildGpuBundle,
} from "../../src/renderer/gpu-recovery";
import type { GpuValidationOptions } from "../../src/renderer/gpu-validation";
import {
  fakeGpuDevice,
  installFreshDeviceNavigator,
  installGpuGlobals,
  type FakeGpu,
} from "./fake-gpu";

const originalNavigator = globalThis.navigator;

let restoreGpuGlobals: (() => void) | undefined;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

function fakeContext(): GPUCanvasContext {
  return { configure: () => undefined } as unknown as GPUCanvasContext;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function installDeferredRecoveryNavigator(candidate: FakeGpu): {
  readonly resolve: () => void;
  readonly requestCount: () => number;
} {
  const device = deferred<GPUDevice>();
  let requestCount = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => {
          requestCount += 1;
          return Promise.resolve({ requestDevice: () => device.promise });
        },
      },
    },
  });
  return {
    resolve: () => {
      device.resolve(candidate.device);
    },
    requestCount: () => requestCount,
  };
}

function lifecycleOptions(
  bundle: Awaited<ReturnType<typeof createGpuBundle>>,
  onLost?: (info: { readonly reason: GPUDeviceLostReason; readonly message: string }) => void,
  validation?: GpuValidationOptions,
): ConstructorParameters<typeof GpuDeviceLifecycle>[0] {
  return {
    bundle,
    context: fakeContext(),
    format: "bgra8unorm",
    depthFormat: "depth24plus",
    powerPreference: undefined,
    ownsDevice: true,
    onLost,
    ...(validation === undefined ? {} : { validation }),
  };
}

describe("createGpuBundle", () => {
  it("creates the device-bound resources for a device", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
      expect(bundle.device).toBe(gpu.device);
      expect(bundle.resources.cameraBuffer).toBeDefined();
      expect(bundle.draw.parts).toBeInstanceOf(Map);
      expect(bundle.pickTargets).toBeDefined();
    } finally {
      restore();
    }
  });
});

describe("rebuildGpuBundle", () => {
  it("requests a device and reconfigures the canvas context for it", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpus = installFreshDeviceNavigator();
    const context = fakeContext();
    const configure = vi.spyOn(context, "configure");
    const bundle = await rebuildGpuBundle(context, "bgra8unorm", "depth24plus");
    expect(bundle.device).toBe(gpus[0]?.device);
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({ device: gpus[0]?.device, format: "bgra8unorm" }),
    );
  });
});

describe("GpuDeviceLifecycle", () => {
  it("reports loss, blocks drawing, and recovers with a fresh device", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    const gpus = installFreshDeviceNavigator(first);
    const onLost = vi.fn();
    const lifecycle = new GpuDeviceLifecycle({
      bundle: await createGpuBundle(first.device, "bgra8unorm", "depth24plus"),
      context: fakeContext(),
      format: "bgra8unorm",
      depthFormat: "depth24plus",
      powerPreference: undefined,
      ownsDevice: true,
      onLost,
    });

    expect(lifecycle.lost).toBe(false);
    first.lose("unknown", "gpu device crashed");
    await first.lost;
    expect(lifecycle.lost).toBe(true);
    expect(onLost).toHaveBeenCalledWith({ reason: "unknown", message: "gpu device crashed" });
    expect(() => {
      lifecycle.ensureUsable();
    }).toThrow(/lost/);

    await expect(lifecycle.recover()).resolves.toBe(true);
    expect(lifecycle.lost).toBe(false);
    const second = gpus[1];
    if (second === undefined) throw new Error("no recovered device created");
    expect(lifecycle.bundle.device).toBe(second.device);
    expect(() => {
      lifecycle.ensureUsable();
    }).not.toThrow();
    second.lose();
    await second.lost;
    expect(lifecycle.lost).toBe(true);
  });

  it("is a no-op when the device is healthy", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    const gpus = installFreshDeviceNavigator(first);
    const lifecycle = new GpuDeviceLifecycle({
      bundle: await createGpuBundle(first.device, "bgra8unorm", "depth24plus"),
      context: fakeContext(),
      format: "bgra8unorm",
      depthFormat: "depth24plus",
      powerPreference: undefined,
      ownsDevice: true,
      onLost: undefined,
    });
    await expect(lifecycle.recover()).resolves.toBe(false);
    expect(gpus).toHaveLength(1);
  });

  it("throws when an externally provided device cannot be recreated", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    installFreshDeviceNavigator(first);
    const lifecycle = new GpuDeviceLifecycle({
      bundle: await createGpuBundle(first.device, "bgra8unorm", "depth24plus"),
      context: fakeContext(),
      format: "bgra8unorm",
      depthFormat: "depth24plus",
      powerPreference: undefined,
      ownsDevice: false,
      onLost: undefined,
    });
    first.lose();
    await first.lost;
    await expect(lifecycle.recover()).rejects.toThrow(EXTERNAL_DEVICE_RECOVERY_MESSAGE);
  });

  it("shares one pending recovery promise and installs one replacement bundle", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    const candidate = fakeGpuDevice();
    const navigatorControl = installDeferredRecoveryNavigator(candidate);
    const lifecycle = new GpuDeviceLifecycle(
      lifecycleOptions(await createGpuBundle(first.device, "bgra8unorm", "depth24plus")),
    );

    first.lose();
    await first.lost;
    const firstRecovery = lifecycle.recover();
    const secondRecovery = lifecycle.recover();
    expect(secondRecovery).toBe(firstRecovery);
    expect(navigatorControl.requestCount()).toBe(1);
    expect(() => {
      lifecycle.ensureUsable();
    }).toThrow(/lost or recovering/);

    navigatorControl.resolve();
    await expect(firstRecovery).resolves.toBe(true);
    await expect(secondRecovery).resolves.toBe(true);
    expect(lifecycle.lost).toBe(false);
    expect(lifecycle.bundle.device).toBe(candidate.device);
    await expect(lifecycle.recover()).resolves.toBe(false);
    lifecycle.destroy();
  });

  it("cleans a candidate bundle when destroyed during asynchronous setup", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    const shaderInfo = deferred<GPUCompilationInfo>();
    const candidate = fakeGpuDevice({ shaderCompilationInfo: () => shaderInfo.promise });
    const navigatorControl = installDeferredRecoveryNavigator(candidate);
    const lifecycle = new GpuDeviceLifecycle(
      lifecycleOptions(await createGpuBundle(first.device, "bgra8unorm", "depth24plus")),
    );

    first.lose();
    await first.lost;
    const recovery = lifecycle.recover();
    navigatorControl.resolve();
    await vi.waitFor(() => {
      expect(candidate.shaderModuleDescriptors.length).toBeGreaterThan(0);
    });
    lifecycle.destroy();
    shaderInfo.resolve({ messages: [] } as unknown as GPUCompilationInfo);

    await expect(recovery).rejects.toThrow(/destroyed during device recovery/);
    expect(candidate.buffers.length).toBeGreaterThan(0);
    expect(candidate.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(() => {
      lifecycle.ensureUsable();
    }).toThrow(/destroyed/);
  });

  it("keeps a replacement device loss lost and reports each generation once", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    const shaderInfo = deferred<GPUCompilationInfo>();
    const candidate = fakeGpuDevice({ shaderCompilationInfo: () => shaderInfo.promise });
    const navigatorControl = installDeferredRecoveryNavigator(candidate);
    const onLost = vi.fn();
    const lifecycle = new GpuDeviceLifecycle(
      lifecycleOptions(await createGpuBundle(first.device, "bgra8unorm", "depth24plus"), onLost),
    );

    first.lose("unknown", "initial loss");
    await first.lost;
    const recovery = lifecycle.recover();
    navigatorControl.resolve();
    await vi.waitFor(() => {
      expect(candidate.shaderModuleDescriptors.length).toBeGreaterThan(0);
    });
    candidate.lose("unknown", "replacement loss");
    await candidate.lost;
    expect(lifecycle.lost).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(2);
    shaderInfo.resolve({ messages: [] } as unknown as GPUCompilationInfo);

    await expect(recovery).rejects.toThrow(/lost during recovery/);
    expect(lifecycle.lost).toBe(true);
    expect(candidate.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    lifecycle.destroy();
  });

  it("keeps failed replacement validation lost and cleans the candidate", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    const gpus = installFreshDeviceNavigator(first);
    const lifecycle = new GpuDeviceLifecycle(
      lifecycleOptions(
        await createGpuBundle(first.device, "bgra8unorm", "depth24plus"),
        undefined,
        { shaderFailureLabel: "triangle color vertex" },
      ),
    );

    first.lose();
    await first.lost;
    await expect(lifecycle.recover()).rejects.toThrow(/triangle color vertex/);
    expect(lifecycle.lost).toBe(true);
    const candidate = gpus[1];
    if (candidate === undefined) throw new Error("no failed recovery device created");
    expect(candidate.buffers).toHaveLength(0);
    lifecycle.destroy();
  });
});
