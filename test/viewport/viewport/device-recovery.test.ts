import { describe, expect, it, vi } from "vitest";
import {
  installNavigator,
  deferred,
  installTwoPhaseNavigator,
  scene,
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";

describe("Viewport", () => {
  it("owns unrecoverable device-loss cleanup and error reporting", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onError = vi.fn();
    await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
      onError,
    });

    gpu.lose("destroyed", "test loss");

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("suppresses recovery callbacks after viewport destruction", async () => {
    installTestGpuGlobals();
    const first = fakeGpuDevice();
    const shaderInfo = deferred<GPUCompilationInfo>();
    const candidate = fakeGpuDevice({ shaderCompilationInfo: () => shaderInfo.promise });
    const resolveCandidate = installTwoPhaseNavigator(first.device, candidate.device);
    const onRecovered = vi.fn();
    const onError = vi.fn();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      onRecovered,
      onError,
    });

    first.lose("unknown", "test loss");
    await first.lost;
    resolveCandidate();
    await vi.waitFor(() => {
      expect(candidate.shaderModuleDescriptors.length).toBeGreaterThan(0);
    });
    viewport.destroy();
    shaderInfo.resolve({ messages: [] } as unknown as GPUCompilationInfo);

    await vi.waitFor(() => {
      expect(candidate.buffers.length).toBeGreaterThan(0);
    });
    expect(onRecovered).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(candidate.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("coalesces concurrent viewport recovery callbacks", async () => {
    installTestGpuGlobals();
    installNavigator();
    const onRecovered = vi.fn();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      onRecovered,
    });

    const firstRecovery = viewport.recover();
    const secondRecovery = viewport.recover();
    expect(secondRecovery).toBe(firstRecovery);
    await firstRecovery;
    await secondRecovery;
    expect(onRecovered).toHaveBeenCalledOnce();
    viewport.destroy();
  });
});
