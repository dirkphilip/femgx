import { describe, expect, it } from "vitest";
import { createCamera } from "../../src/camera/camera";
import { fitCamera } from "../../src/camera/fit";
import { zoomCameraWithinBounds } from "../../src/camera/navigation";
import type { Bounds } from "../../src/geometry/part";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createBoltedPlateFixture } from "../../demo/fixture/bolted-plate";
import { sceneWorldBounds } from "../../src/viewport/scene-bounds";

const bounds: Bounds = {
  minX: -1,
  minY: -1,
  minZ: -1,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
};

describe("bounds-aware camera navigation", () => {
  it("keeps a small fitted zoom step continuous", () => {
    const camera = fitCamera(createCamera({ width: 1152, height: 900 }), bounds, 1152, 900);
    const zoomed = zoomCameraWithinBounds(camera, -0.1, bounds);
    expect(distance(zoomed.position, zoomed.target)).toBeCloseTo(
      distance(camera.position, camera.target) * Math.exp(-0.1),
      5,
    );
    expect(safelyFramesBounds(zoomed, bounds)).toBe(true);
  });

  it("allows zoom-out beyond fit and approximately returns", () => {
    const camera = fitCamera(createCamera({ width: 1152, height: 900 }), bounds, 1152, 900);
    const farther = zoomCameraWithinBounds(camera, 2, bounds);
    const restored = zoomCameraWithinBounds(farther, -2, bounds);
    expect(distance(farther.position, farther.target)).toBeGreaterThan(
      distance(camera.position, camera.target),
    );
    expect(restored.position[0]).toBeCloseTo(camera.position[0], 5);
    expect(restored.position[1]).toBeCloseTo(camera.position[1], 5);
    expect(restored.position[2]).toBeCloseTo(camera.position[2], 5);
    expect(restored.near).toBeCloseTo(camera.near, 5);
    expect(restored.far).toBeCloseTo(camera.far, 5);
    expect(safelyFramesBounds(restored, bounds)).toBe(true);
  });

  it("stops before the camera enters the navigation bounds", () => {
    let camera = fitCamera(createCamera({ width: 390, height: 560 }), bounds, 390, 560);
    for (let step = 0; step < 100; step += 1) {
      camera = zoomCameraWithinBounds(camera, -0.2, bounds);
    }
    expect(safelyFramesBounds(camera, bounds)).toBe(true);
    expect(Math.min(...depths(camera, bounds))).toBeGreaterThan(camera.near);
    expect(Math.max(...depths(camera, bounds))).toBeLessThan(camera.far);
  });

  it("does not couple orthographic screen scale to far distance", () => {
    const camera = fitCamera(
      createCamera({ mode: "orthographic", far: 10, width: 400, height: 400 }),
      bounds,
      400,
      400,
    );
    const zoomed = zoomCameraWithinBounds(camera, 4, bounds);
    expect(zoomed.orthoHeight).toBeGreaterThan(zoomed.far);
    expect(safelyFramesBounds(zoomed, bounds)).toBe(true);
  });

  it("uses the real bolted bounds for both desktop and mobile fit transitions", () => {
    const fixture = createBoltedPlateFixture();
    const runtime = createPackedSceneRuntime(fixture.scene);
    const fixtureBounds = sceneWorldBounds(fixture.scene, runtime);
    for (const [width, height] of [
      [1152, 900],
      [390, 560],
    ] as const) {
      const fitted = fitCamera(createCamera({ width, height }), fixtureBounds, width, height);
      const zoomed = zoomCameraWithinBounds(fitted, -0.25, fixtureBounds);
      expect(distance(fitted.position, fitted.target)).toBeGreaterThan(fitted.far / 2);
      expect(distance(zoomed.position, zoomed.target)).toBeGreaterThan(fitted.far / 2);
      expect(safelyFramesBounds(zoomed, fixtureBounds)).toBe(true);
      expect(zoomed.position).not.toEqual(fitted.position);
    }
  });

  it.each([
    ["wide", { minX: -100, minY: -1, minZ: -1, maxX: 100, maxY: 1, maxZ: 1 }],
    ["tall", { minX: -1, minY: -100, minZ: -1, maxX: 1, maxY: 100, maxZ: 1 }],
    ["flat", { minX: -10, minY: -10, minZ: 0, maxX: 10, maxY: 10, maxZ: 0 }],
    ["line-like", { minX: -100, minY: 0, minZ: 0, maxX: 100, maxY: 0, maxZ: 0 }],
    ["point-like", { minX: 2, minY: 3, minZ: 4, maxX: 2, maxY: 3, maxZ: 4 }],
    ["tiny", { minX: -1e-12, minY: -1e-12, minZ: -1e-12, maxX: 1e-12, maxY: 1e-12, maxZ: 1e-12 }],
    ["large", { minX: -5e11, minY: -5e11, minZ: -5e11, maxX: 5e11, maxY: 5e11, maxZ: 5e11 }],
  ] as const)("keeps %s bounds finite and safely framed", (_name, modelBounds) => {
    const fitted = fitCamera(createCamera({ width: 390, height: 844 }), modelBounds, 390, 844);
    const zoomed = zoomCameraWithinBounds(fitted, -100, modelBounds);
    expect(Number.isFinite(zoomed.near)).toBe(true);
    expect(Number.isFinite(zoomed.far)).toBe(true);
    expect(safelyFramesBounds(zoomed, modelBounds)).toBe(true);
  });

  it("preserves identity for no-op and already-clamped transitions", () => {
    const fitted = fitCamera(createCamera(), bounds, 1152, 900);
    expect(zoomCameraWithinBounds(fitted, 0, bounds)).toBe(fitted);
    let closest = fitted;
    for (let step = 0; step < 100; step += 1) {
      closest = zoomCameraWithinBounds(closest, -0.2, bounds);
    }
    expect(zoomCameraWithinBounds(closest, -1e6, bounds)).toBe(closest);
  });
});

function depths(camera: ReturnType<typeof createCamera>, modelBounds: Bounds): number[] {
  const forward = normalize([
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]);
  return corners(modelBounds).map((corner) =>
    dot(
      [
        corner[0] - camera.position[0],
        corner[1] - camera.position[1],
        corner[2] - camera.position[2],
      ],
      forward,
    ),
  );
}

function safelyFramesBounds(camera: ReturnType<typeof createCamera>, modelBounds: Bounds): boolean {
  const values = depths(camera, modelBounds);
  return Math.min(...values) > camera.near && Math.max(...values) < camera.far;
}

function corners(modelBounds: Bounds): readonly (readonly [number, number, number])[] {
  return [
    [modelBounds.minX, modelBounds.minY, modelBounds.minZ],
    [modelBounds.minX, modelBounds.minY, modelBounds.maxZ],
    [modelBounds.minX, modelBounds.maxY, modelBounds.minZ],
    [modelBounds.minX, modelBounds.maxY, modelBounds.maxZ],
    [modelBounds.maxX, modelBounds.minY, modelBounds.minZ],
    [modelBounds.maxX, modelBounds.minY, modelBounds.maxZ],
    [modelBounds.maxX, modelBounds.maxY, modelBounds.minZ],
    [modelBounds.maxX, modelBounds.maxY, modelBounds.maxZ],
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function normalize(vector: readonly number[]): readonly number[] {
  const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0);
  return [(vector[0] ?? 0) / length, (vector[1] ?? 0) / length, (vector[2] ?? 0) / length];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}
