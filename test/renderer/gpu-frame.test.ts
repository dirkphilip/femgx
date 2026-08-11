import { afterEach, describe, expect, it } from "vitest";
import { pointSizeDevicePixels } from "../../src/renderer/gpu-frame";
import { orbitPivotAxisDirection, orbitPivotMetrics } from "../../src/renderer/gpu-orbit-pivot";
import { createCamera, resizeCamera } from "../../src/camera/camera";

const originalDevicePixelRatio = globalThis.devicePixelRatio;

afterEach(() => {
  Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    value: originalDevicePixelRatio,
  });
});

describe("pointSizeDevicePixels", () => {
  it("scales CSS point size by devicePixelRatio", () => {
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    expect(pointSizeDevicePixels(8)).toBe(16);
    expect(pointSizeDevicePixels(8, 1)).toBe(8);
    expect(pointSizeDevicePixels(8, 3)).toBe(24);
  });

  it("never returns less than one device pixel", () => {
    expect(pointSizeDevicePixels(0.1, 1)).toBe(1);
  });
});

describe("orbit pivot widget", () => {
  it("keeps its dimensions in device pixels across display densities", () => {
    expect(orbitPivotMetrics(8)).toEqual({
      axisLength: 32,
      lineWidth: 4,
      arrowLength: 9,
      arrowWidth: 7,
    });
    expect(orbitPivotMetrics(16)).toEqual({
      axisLength: 64,
      lineWidth: 8,
      arrowLength: 18,
      arrowWidth: 14,
    });
  });

  it("projects world axes into camera-oriented screen directions", () => {
    const camera = resizeCamera(createCamera({ position: [4, 3, 6], target: [0, 0, 0] }), 800, 600);
    const pivot = [0, 0, 0] as const;
    const x = orbitPivotAxisDirection(camera, pivot, [1, 0, 0]);
    const y = orbitPivotAxisDirection(camera, pivot, [0, 1, 0]);
    const z = orbitPivotAxisDirection(camera, pivot, [0, 0, 1]);
    expect(Math.hypot(...x)).toBeCloseTo(1);
    expect(Math.hypot(...y)).toBeCloseTo(1);
    expect(Math.hypot(...z)).toBeCloseTo(1);
    expect(x).not.toEqual(y);
    expect(y).not.toEqual(z);
  });
});
