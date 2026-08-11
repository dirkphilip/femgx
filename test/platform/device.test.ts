import { afterEach, describe, expect, it } from "vitest";
import {
  requestWebGpuDevice,
  watchDeviceLoss,
  type DeviceLostInfo,
} from "../../src/platform/device";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

function installNavigator(
  gpu: {
    requestAdapter?: () => Promise<{ requestDevice: () => Promise<GPUDevice> } | null>;
  } | null,
): void {
  const navigatorValue = gpu === null ? {} : { gpu: { requestAdapter: gpu.requestAdapter } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigatorValue,
  });
}

describe("requestWebGpuDevice", () => {
  it("returns the adapter and device pair", async () => {
    const device = {} as GPUDevice;
    const adapter = { requestDevice: () => Promise.resolve(device) };
    installNavigator({ requestAdapter: () => Promise.resolve(adapter) });
    await expect(requestWebGpuDevice()).resolves.toEqual({ adapter, device });
  });

  it("throws a typed adapter-unavailable error when no adapter is found", async () => {
    installNavigator({ requestAdapter: () => Promise.resolve(null) });
    await expect(requestWebGpuDevice()).rejects.toMatchObject({ reason: "adapter-unavailable" });
  });

  it("throws a typed device-unavailable error when device creation fails", async () => {
    installNavigator({
      requestAdapter: () =>
        Promise.resolve({ requestDevice: () => Promise.reject(new Error("driver error")) }),
    });
    await expect(requestWebGpuDevice()).rejects.toMatchObject({ reason: "device-unavailable" });
  });
});

describe("watchDeviceLoss", () => {
  it("reports the loss reason and message when the device is lost", async () => {
    let resolveLost!: (info: GPUDeviceLostInfo) => void;
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
      resolveLost = resolve;
    });
    const seen: DeviceLostInfo[] = [];
    watchDeviceLoss({ lost } as unknown as GPUDevice, (info) => seen.push(info));
    resolveLost({ reason: "destroyed", message: "device unmapped" } as GPUDeviceLostInfo);
    await lost;
    await Promise.resolve();
    expect(seen).toEqual([{ reason: "destroyed", message: "device unmapped" }]);
  });

  it("reports an unknown reason when the lost promise rejects", async () => {
    const lost = Promise.reject(new Error("unexpected loss"));
    const seen: DeviceLostInfo[] = [];
    watchDeviceLoss({ lost } as unknown as GPUDevice, (info) => seen.push(info));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toBe("unknown");
    expect(seen[0]?.message).toContain("lost");
  });

  it("detaches a stale loss callback when disposed", async () => {
    let resolveLost!: (info: GPUDeviceLostInfo) => void;
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
      resolveLost = resolve;
    });
    const seen: DeviceLostInfo[] = [];
    const dispose = watchDeviceLoss({ lost } as unknown as GPUDevice, (info) => seen.push(info));
    dispose();
    resolveLost({ reason: "destroyed", message: "stale device" } as GPUDeviceLostInfo);
    await lost;
    await Promise.resolve();
    expect(seen).toEqual([]);
  });
});
