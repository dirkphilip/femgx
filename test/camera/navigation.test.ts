import { describe, expect, it } from "vitest";
import { createCamera, projectPoint } from "../../src/camera/camera";
import { fitCamera } from "../../src/camera/fit";
import {
  cameraDepthMargin,
  minimumCameraDepth,
  orbitCameraWithinBounds,
  protectCameraWithinBounds,
  updateCameraClipPlanes,
  zoomCameraWithinBounds,
} from "../../src/camera/navigation";
import type { Bounds } from "../../src/geometry/part";
import type { Vec3 } from "../../src/math/vec3";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createBoltedPlateFixture } from "../../demo/fixtures/bolted-plate";
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
  it.each(["perspective", "orthographic"] as const)(
    "recomputes clip planes after a safe %s orbit",
    (mode) => {
      const initial = fitCamera(
        createCamera({ mode, near: 0.01, far: 10_000, width: 1152, height: 900 }),
        bounds,
        1152,
        900,
      );
      const orbited = orbitCameraWithinBounds(initial, 0.4, 0.2, undefined, bounds);

      expect(orbited).not.toBe(initial);
      expect(orbited.far).not.toBe(initial.far);
      expect(safelyFramesBounds(orbited, bounds)).toBe(true);
    },
  );

  it("applies a full off-center orbit and moves the eye outward when needed", () => {
    const modelBounds = {
      minX: -100,
      minY: -1,
      minZ: -1,
      maxX: 100,
      maxY: 1,
      maxZ: 1,
    };
    const initial = fitCamera(
      createCamera({ mode: "perspective", width: 1152, height: 900 }),
      modelBounds,
      1152,
      900,
    );
    const limited = orbitCameraWithinBounds(initial, Math.PI, 0, [1000, 0, 0], modelBounds);

    expect(limited).not.toBe(initial);
    expect(distance(limited.target, [1000, 0, 0])).toBeCloseTo(
      distance(initial.target, [1000, 0, 0]),
    );
    expect(distance(limited.position, limited.target)).toBeGreaterThanOrEqual(
      distance(initial.position, initial.target),
    );
    expect(safelyFramesBounds(limited, modelBounds)).toBe(true);
  });

  it("keeps the first off-center orbit step proportional to pointer movement", () => {
    const initial = fitCamera(
      createCamera({ mode: "perspective", width: 1152, height: 900 }),
      bounds,
      1152,
      900,
    );
    const pivot: Vec3 = [1, 0, 0];
    const rotated = orbitCameraWithinBounds(initial, 0.001, 0, pivot, bounds);

    expect(distance(rotated.target, initial.target)).toBeLessThan(0.01);
    expect(rotated.target).not.toEqual(pivot);
    const beforePivot = projectPoint(initial, pivot);
    const afterPivot = projectPoint(rotated, pivot);
    expect(afterPivot?.[0]).toBeCloseTo(beforePivot?.[0] ?? NaN, 4);
    expect(afterPivot?.[1]).toBeCloseTo(beforePivot?.[1] ?? NaN, 4);
  });

  it("preserves identity for a no-op and never blocks an unsafe orbit", () => {
    const noOp = fitCamera(createCamera({ mode: "perspective" }), bounds, 1152, 900);
    expect(orbitCameraWithinBounds(noOp, 0, 0, undefined, bounds)).toBe(noOp);

    const blocked = createCamera({
      mode: "perspective",
      position: [0, 0, 0.5],
      target: [0, 0, 0],
    });
    const rotated = orbitCameraWithinBounds(blocked, 0.2, 0.1, undefined, bounds);
    expect(rotated).not.toBe(blocked);
    expect(rotated.target).toEqual(blocked.target);
    expect(safelyFramesBounds(rotated, bounds)).toBe(true);
  });

  it("keeps a small fitted zoom step continuous", () => {
    const camera = fitCamera(
      createCamera({ mode: "perspective", width: 1152, height: 900 }),
      bounds,
      1152,
      900,
    );
    const zoomed = zoomCameraWithinBounds(camera, -0.1, bounds);
    expect(distance(zoomed.position, zoomed.target)).toBeCloseTo(
      distance(camera.position, camera.target) * Math.exp(-0.1),
      5,
    );
    expect(safelyFramesBounds(zoomed, bounds)).toBe(true);
  });

  it("allows zoom-out beyond fit and approximately returns", () => {
    const camera = fitCamera(
      createCamera({ mode: "perspective", width: 1152, height: 900 }),
      bounds,
      1152,
      900,
    );
    const farther = zoomCameraWithinBounds(camera, 2, bounds);
    const restored = zoomCameraWithinBounds(farther, -2, bounds);
    expect(distance(farther.position, farther.target)).toBeGreaterThan(
      distance(camera.position, camera.target),
    );
    expect(restored.position[0]).toBeCloseTo(camera.position[0], 5);
    expect(restored.position[1]).toBeCloseTo(camera.position[1], 5);
    expect(restored.position[2]).toBeCloseTo(camera.position[2], 5);
    expect(restored.near).toBeLessThanOrEqual(distance(restored.position, restored.target) * 0.001);
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

  it("updates clipping for many protected occurrences without argument-list overflow", () => {
    const camera = fitCamera(createCamera({ mode: "perspective" }), bounds, 1152, 900);
    const updated = updateCameraClipPlanes(
      camera,
      bounds,
      cameraDepthMargin(bounds),
      Array.from({ length: 20_000 }, () => bounds),
    );

    expect(updated.near).toBeGreaterThan(0);
    expect(updated.far).toBeGreaterThan(updated.near);
  });

  it("uses the real bolted bounds for both desktop and mobile fit transitions", () => {
    const fixture = createBoltedPlateFixture();
    const runtime = createPackedSceneRuntime(fixture.scene);
    const fixtureBounds = sceneWorldBounds(fixture.scene, runtime);
    for (const [width, height] of [
      [1152, 900],
      [390, 560],
    ] as const) {
      const fitted = fitCamera(
        createCamera({ mode: "perspective", width, height }),
        fixtureBounds,
        width,
        height,
      );
      const zoomed = zoomCameraWithinBounds(fitted, -0.25, fixtureBounds);
      expect(distance(fitted.position, fitted.target)).toBeGreaterThan(fitted.far / 2);
      expect(distance(zoomed.position, zoomed.target)).toBeGreaterThan(fitted.far / 2);
      expect(safelyFramesBounds(zoomed, fixtureBounds)).toBe(true);
      expect(zoomed.position).not.toEqual(fitted.position);
    }
  });

  it.each(["perspective", "orthographic"] as const)(
    "keeps a displayed %s point as the stable zoom target",
    (mode) => {
      const fixture = createBoltedPlateFixture();
      const runtime = createPackedSceneRuntime(fixture.scene);
      const fixtureBounds = sceneWorldBounds(fixture.scene, runtime);
      const fitted = fitCamera(
        createCamera({ mode, width: 1152, height: 900 }),
        fixtureBounds,
        1152,
        900,
      );
      const anchor: Vec3 = [0, 3, 0];
      const zoomed = zoomCameraWithinBounds(fitted, -100, fixtureBounds, anchor);
      const zoomedScreen = projectPoint(zoomed, anchor);

      expect(zoomed.target).toEqual(anchor);
      expect(safelyFramesBounds(zoomed, fixtureBounds)).toBe(true);
      expect(zoomed.near).toBeGreaterThan(0);
      expect(zoomed.far).toBeGreaterThan(zoomed.near);
      expect(zoomedScreen?.[0]).toBeCloseTo(1152 / 2, 3);
      expect(zoomedScreen?.[1]).toBeCloseTo(900 / 2, 3);
    },
  );

  it("protects each placed bound without stopping at empty union space", () => {
    const anchorBounds: Bounds = {
      minX: -0.1,
      minY: -0.1,
      minZ: -0.1,
      maxX: 0.1,
      maxY: 0.1,
      maxZ: 0.1,
    };
    const remoteBounds: Bounds = {
      minX: 9.9,
      minY: -0.1,
      minZ: -5.1,
      maxX: 10.1,
      maxY: 0.1,
      maxZ: -4.9,
    };
    const unionBounds: Bounds = {
      minX: anchorBounds.minX,
      minY: anchorBounds.minY,
      minZ: remoteBounds.minZ,
      maxX: remoteBounds.maxX,
      maxY: anchorBounds.maxY,
      maxZ: anchorBounds.maxZ,
    };
    const camera = createCamera({
      mode: "perspective",
      position: [10, 0, 10],
      target: [0, 0, 0],
      width: 1152,
      height: 900,
    });
    const unionOnly = zoomCameraWithinBounds(camera, -100, unionBounds);
    const protectedByOccurrence = zoomCameraWithinBounds(
      camera,
      -100,
      unionBounds,
      [0, 0, 0],
      [anchorBounds, remoteBounds],
    );

    expect(distance(protectedByOccurrence.position, camera.target)).toBeLessThan(
      distance(unionOnly.position, camera.target) * 0.75,
    );
    expect(minimumCameraDepth(protectedByOccurrence, remoteBounds)).toBeGreaterThan(
      cameraDepthMargin(remoteBounds),
    );
  });

  it("does not let a local approach pass through a dense solid bound", () => {
    const solidBounds: Bounds = {
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    };
    const fitted = fitCamera(
      createCamera({ mode: "perspective", width: 1152, height: 900 }),
      solidBounds,
      1152,
      900,
    );
    const anchor: Vec3 = [0, 0, 1];
    const zoomed = zoomCameraWithinBounds(fitted, -100, solidBounds, anchor);

    let closest = zoomed;
    for (let step = 0; step < 20; step += 1) {
      closest = zoomCameraWithinBounds(closest, -1, solidBounds, anchor);
    }
    expect(pointDepth(closest, anchor)).toBeGreaterThan(cameraDepthMargin(solidBounds));
    expect(zoomCameraWithinBounds(closest, -1, solidBounds, anchor).position).toEqual(
      closest.position,
    );
  });

  it("moves a selection-fitted camera before the full model instead of clipping it", () => {
    const selectedBounds: Bounds = {
      minX: -0.5,
      minY: -0.5,
      minZ: -0.5,
      maxX: 0.5,
      maxY: 0.5,
      maxZ: 0.5,
    };
    const fullBounds: Bounds = {
      minX: -1,
      minY: -1,
      minZ: -0.5,
      maxX: 1,
      maxY: 1,
      maxZ: 5.5,
    };
    const remoteBounds: Bounds = {
      minX: -1,
      minY: -1,
      minZ: 4.5,
      maxX: 1,
      maxY: 1,
      maxZ: 5.5,
    };
    const selectionFit = fitCamera(
      createCamera({ mode: "perspective", position: [0, 0, 10], width: 800, height: 600 }),
      selectedBounds,
      800,
      600,
    );
    const protectedCamera = protectCameraWithinBounds(selectionFit, fullBounds, [
      selectedBounds,
      remoteBounds,
    ]);

    expect(protectedCamera.position[2]).toBeGreaterThan(selectionFit.position[2]);
    expect(protectedCamera.target).toEqual(selectionFit.target);
    expect(safelyFramesBounds(protectedCamera, selectedBounds)).toBe(true);
    expect(safelyFramesBounds(protectedCamera, fullBounds)).toBe(true);
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

  it("preserves identity for no-op and keeps an already-clamped eye fixed", () => {
    const fitted = fitCamera(createCamera({ mode: "perspective" }), bounds, 1152, 900);
    expect(zoomCameraWithinBounds(fitted, 0, bounds)).toBe(fitted);
    let closest = fitted;
    for (let step = 0; step < 100; step += 1) {
      closest = zoomCameraWithinBounds(closest, -0.2, bounds);
    }
    expect(zoomCameraWithinBounds(closest, -1e6, bounds).position).toEqual(closest.position);
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

function pointDepth(camera: ReturnType<typeof createCamera>, point: Vec3): number {
  const forward = normalize([
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]);
  return dot(
    [point[0] - camera.position[0], point[1] - camera.position[1], point[2] - camera.position[2]],
    forward,
  );
}
