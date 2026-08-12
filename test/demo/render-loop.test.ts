import { describe, expect, it, vi } from "vitest";
import {
  calculateRenderLoopStats,
  IDLE_RENDER_LOOP_STATS,
  WorkbenchRenderLoop,
} from "../../demo/workbench/render-loop";

describe("WorkbenchRenderLoop", () => {
  it("stays idle by default and starts one invalidation chain", () => {
    const viewport = { invalidate: vi.fn() };
    const loop = new WorkbenchRenderLoop(() => viewport);

    expect(loop.stats).toEqual(IDLE_RENDER_LOOP_STATS);
    loop.setEnabled(true, 0);
    loop.setEnabled(true, 0);

    expect(viewport.invalidate).toHaveBeenCalledOnce();
  });

  it("requests exactly one next frame after each completed frame", () => {
    const viewport = { invalidate: vi.fn() };
    const loop = new WorkbenchRenderLoop(() => viewport);
    loop.setEnabled(true, 0);

    expect(loop.frameCompleted(16)).toBe(true);
    expect(loop.frameCompleted(32)).toBe(false);
    expect(viewport.invalidate).toHaveBeenCalledTimes(3);
  });

  it("stops continuation on disable, detach, and destroy", () => {
    const viewport = { invalidate: vi.fn() };
    const loop = new WorkbenchRenderLoop(() => viewport);
    loop.setEnabled(true, 0);
    loop.setEnabled(false, 16);
    loop.frameCompleted(32);
    expect(viewport.invalidate).toHaveBeenCalledOnce();

    loop.setEnabled(true, 48);
    loop.detach(64);
    loop.frameCompleted(80);
    expect(viewport.invalidate).toHaveBeenCalledTimes(2);

    loop.attach(96);
    loop.frameCompleted(112);
    loop.stop();
    loop.frameCompleted(128);
    expect(viewport.invalidate).toHaveBeenCalledTimes(4);
    expect(loop.stats).toEqual(IDLE_RENDER_LOOP_STATS);
  });

  it("evicts old samples and calculates bounded percentiles", () => {
    const stats = calculateRenderLoopStats([0, 10, 30, 70, 100], -500, 100);

    expect(stats.state).toBe("Continuous");
    expect(stats.sampleFrameCount).toBe(5);
    expect(stats.sampleDurationMs).toBe(100);
    expect(stats.averageFps).toBe(40);
    expect(stats.p50FrameIntervalMs).toBe(25);
    expect(stats.p95FrameIntervalMs).toBe(38.5);
    expect(stats.longestFrameIntervalMs).toBe(40);

    const viewport = { invalidate: vi.fn() };
    const loop = new WorkbenchRenderLoop(() => viewport);
    loop.setEnabled(true, 0);
    loop.frameCompleted(0);
    loop.frameCompleted(100);
    loop.frameCompleted(2_600);
    expect(loop.stats.sampleFrameCount).toBe(2);
    expect(loop.stats.sampleDurationMs).toBe(2_500);
    expect(loop.stats.averageFps).toBeCloseTo(0.4);
  });

  it("keeps zero and one-sample reports finite", () => {
    expect(calculateRenderLoopStats([], 0, 100)).toEqual({
      ...IDLE_RENDER_LOOP_STATS,
      state: "Warming up",
      sampleDurationMs: 100,
    });
    const one = calculateRenderLoopStats([100], 0, 100);
    expect(one.averageFps).toBe(0);
    expect(one.p50FrameIntervalMs).toBeUndefined();
    expect(one.p95FrameIntervalMs).toBeUndefined();
    expect(one.longestFrameIntervalMs).toBeUndefined();
    expect(
      Object.values(one).every((value) => typeof value !== "number" || Number.isFinite(value)),
    ).toBe(true);
  });
});
