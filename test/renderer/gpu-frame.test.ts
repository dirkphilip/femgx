import { afterEach, describe, expect, it } from "vitest";
import { cameraKeyLightDirection, pointSizeDevicePixels } from "../../src/renderer/gpu-frame";
import { orbitPivotAxisProjection, orbitPivotMetrics } from "../../src/renderer/gpu-orbit-pivot";
import { createCamera, orbitCamera, resizeCamera } from "../../src/camera/camera";

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

describe("cameraKeyLightDirection", () => {
  it.each([
    createCamera({ position: [4, 3, 6], target: [0, 0, 0] }),
    createCamera({ position: [0, 4, 0], target: [0, 0, 0], up: [1, 0, 0] }),
    createCamera({ position: [0, -4, 0], target: [0, 0, 0], up: [1, 0, 0] }),
  ])("returns a finite normalized direction for valid camera #%#", (camera) => {
    const direction = cameraKeyLightDirection(camera);
    expect(direction.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...direction)).toBeCloseTo(1);
  });

  it("follows the view while retaining a small upward bias", () => {
    const direction = cameraKeyLightDirection(
      createCamera({ position: [0, 0, 4], target: [0, 0, 0] }),
    );
    expect(direction[2]).toBeGreaterThan(direction[1]);
    expect(direction[1]).toBeGreaterThan(0);
  });

  it("stays finite through continuous pole-crossing camera frames", () => {
    let camera = createCamera({ position: [0, 0, 4], target: [0, 0, 0] });
    for (let step = 0; step < 8; step += 1) {
      camera = orbitCamera(camera, 0.2, Math.PI / 2);
      const light = cameraKeyLightDirection(camera);
      const projection = orbitPivotAxisProjection(camera, [1, 0, 0]);
      expect(light.every(Number.isFinite)).toBe(true);
      expect(projection.every(Number.isFinite)).toBe(true);
    }
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

  it("foreshortens a world axis as it faces the camera", () => {
    const camera = resizeCamera(createCamera({ position: [4, 3, 6], target: [0, 0, 0] }), 800, 600);
    const x = orbitPivotAxisProjection(camera, [1, 0, 0]);
    const y = orbitPivotAxisProjection(camera, [0, 1, 0]);
    const z = orbitPivotAxisProjection(camera, [0, 0, 1]);
    expect(Math.hypot(...x)).toBeLessThan(1);
    expect(Math.hypot(...y)).toBeLessThan(1);
    expect(Math.hypot(...z)).toBeLessThan(1);
    expect(x).not.toEqual(y);
    expect(y).not.toEqual(z);

    const faceOn = orbitPivotAxisProjection(
      createCamera({ position: [5, 0, 0], target: [0, 0, 0] }),
      [1, 0, 0],
    );
    expect(faceOn).toEqual([0, 0]);
  });
});
