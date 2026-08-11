import { describe, expect, it } from "vitest";
import {
  createCamera,
  orbitCamera,
  panCamera,
  projectPoint,
  unprojectPoint,
  projectionMatrix,
  resizeCamera,
  setProjection,
  zoomCamera,
  zoomCameraAtPoint,
} from "../../src/camera/camera";

describe("camera", () => {
  it.each(["perspective", "orthographic"] as const)(
    "round-trips displayed world points through %s projection",
    (mode) => {
      const camera = createCamera({
        mode,
        position: [4, 3, 7],
        target: [0, 0, 0],
        width: 973,
        height: 611,
        near: 0.1,
        far: 100,
      });
      const world = [0.4, -0.2, 0.7] as const;
      const screen = projectPoint(camera, world);
      expect(screen).toBeDefined();
      const restored = unprojectPoint(camera, screen ?? [0, 0, 0]);
      expect(restored[0]).toBeCloseTo(world[0], 4);
      expect(restored[1]).toBeCloseTo(world[1], 4);
      expect(restored[2]).toBeCloseTo(world[2], 4);
    },
  );
  it("projects the target near the center of the viewport", () => {
    const camera = resizeCamera(createCamera(), 800, 600);
    const point = projectPoint(camera, [0, 0, 0]);
    expect(point?.[0]).toBeCloseTo(400);
    expect(point?.[1]).toBeCloseTo(300);
  });

  it("supports orthographic projection and resize", () => {
    const camera = setProjection(resizeCamera(createCamera(), 800, 600), "orthographic");
    const before = projectPoint(camera, [1, 0, 0]);
    const after = projectPoint(resizeCamera(camera, 400, 600), [1, 0, 0]);
    expect(before?.[0]).toBeGreaterThan(400);
    expect(after?.[0]).toBeGreaterThan(200);
    expect(projectionMatrix(camera)[15]).toBe(1);
  });

  it("preserves framing when switching projection modes", () => {
    const perspective = resizeCamera(createCamera(), 800, 600);
    const orthographic = setProjection(perspective, "orthographic");
    const restored = setProjection(orthographic, "perspective");
    expect(restored.position[0]).toBeCloseTo(perspective.position[0]);
    expect(restored.position[1]).toBeCloseTo(perspective.position[1]);
    expect(restored.position[2]).toBeCloseTo(perspective.position[2]);
  });

  it("keeps camera controls immutable", () => {
    const camera = createCamera();
    const controlled = zoomCamera(panCamera(orbitCamera(camera, 0.2, 0.1), 1, 2), -0.3);
    expect(controlled).not.toBe(camera);
    expect(camera.position).toEqual([3, 3, 5]);
  });

  it("orbits rigidly around an explicit picked pivot", () => {
    const camera = createCamera({ position: [0, 0, 5], target: [0, 0, 0] });
    const pivot: readonly [number, number, number] = [2, 0, 0];
    const rotated = orbitCamera(camera, 0.4, 0.2, pivot);
    expect(distance(rotated.position, pivot)).toBeCloseTo(distance(camera.position, pivot));
    expect(distance(rotated.target, pivot)).toBeCloseTo(distance(camera.target, pivot));
    expect(rotated.target).not.toEqual(camera.target);
  });

  it("stops short of the poles so the orbit frame never flips", () => {
    const camera = createCamera({ position: [0, 0, 5], target: [0, 0, 0] });
    const atPoleLimit = orbitCamera(camera, 0, Math.PI);
    const beyondPoleLimit = orbitCamera(atPoleLimit, 0, Math.PI);
    expect(atPoleLimit.position[1]).toBeLessThan(-4.9);
    expect(atPoleLimit.position[2]).toBeGreaterThan(0);
    expect(distance(beyondPoleLimit.position, atPoleLimit.position)).toBeLessThan(1e-9);
    expect(distance(beyondPoleLimit.target, atPoleLimit.target)).toBeLessThan(1e-9);
  });

  it("adapts the perspective near plane instead of stopping close zoom", () => {
    const camera = createCamera({ position: [0, 0, 1], target: [0, 0, 0], near: 0.01 });
    const zoomed = zoomCamera(camera, -20);
    expect(zoomed.position[2]).toBeLessThan(0.01);
    expect(zoomed.near).toBeLessThan(camera.near);
  });

  it.each(["perspective", "orthographic"] as const)(
    "keeps a cursor pivot under the same screen point while zooming in %s",
    (mode) => {
      const camera = setProjection(
        resizeCamera(createCamera({ position: [4, 3, 7], target: [0, 0, 0] }), 973, 611),
        mode,
      );
      const pivot = [0.4, -0.2, 0.7] as const;
      const before = projectPoint(camera, pivot);
      const after = projectPoint(zoomCameraAtPoint(camera, -0.4, pivot), pivot);
      expect(after?.[0]).toBeCloseTo(before?.[0] ?? NaN, 5);
      expect(after?.[1]).toBeCloseTo(before?.[1] ?? NaN, 5);
    },
  );

  it("maps the perspective near and far planes to WebGPU [0, 1] depth", () => {
    const camera = resizeCamera(
      createCamera({ position: [0, 0, 0], target: [0, 0, -1], near: 1, far: 100 }),
      800,
      600,
    );
    const nearDepth = projectPoint(camera, [0, 0, -1])?.[2] ?? NaN;
    const farDepth = projectPoint(camera, [0, 0, -100])?.[2] ?? NaN;
    expect(nearDepth).toBeCloseTo(0);
    expect(farDepth).toBeCloseTo(1);
  });

  it("maps the orthographic near and far planes to WebGPU [0, 1] depth", () => {
    const camera = resizeCamera(
      setProjection(
        createCamera({ position: [0, 0, 0], target: [0, 0, -1], near: 1, far: 100 }),
        "orthographic",
      ),
      800,
      600,
    );
    const nearDepth = projectPoint(camera, [0, 0, -1])?.[2] ?? NaN;
    const farDepth = projectPoint(camera, [0, 0, -100])?.[2] ?? NaN;
    expect(nearDepth).toBeCloseTo(0);
    expect(farDepth).toBeCloseTo(1);
  });
});

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
