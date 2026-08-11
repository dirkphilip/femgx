import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGpuBundle,
  EXTERNAL_DEVICE_RECOVERY_MESSAGE,
  GpuDeviceLifecycle,
  rebuildGpuBundle,
} from "../../src/renderer/gpu-recovery";
import { fakeGpuDevice, installFreshDeviceNavigator, installGpuGlobals } from "./fake-gpu";

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
});
