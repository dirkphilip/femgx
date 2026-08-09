import { describe, expect, it } from "vitest";
import {
  createCamera,
  orbitCamera,
  panCamera,
  projectPoint,
  projectionMatrix,
  resizeCamera,
  setProjection,
  zoomCamera,
} from "../../src/camera/camera";

describe("camera", () => {
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

  it("rotates continuously through the old pitch limit", () => {
    const camera = createCamera({ position: [0, 0, 5], target: [0, 0, 0] });
    const halfway = orbitCamera(camera, 0, Math.PI);
    const fullTurn = orbitCamera(camera, 0, Math.PI * 2);
    expect(halfway.position[2]).toBeCloseTo(-5);
    expect(fullTurn.position[0]).toBeCloseTo(camera.position[0]);
    expect(fullTurn.position[1]).toBeCloseTo(camera.position[1]);
    expect(fullTurn.position[2]).toBeCloseTo(camera.position[2]);
  });

  it("adapts the perspective near plane instead of stopping close zoom", () => {
    const camera = createCamera({ position: [0, 0, 1], target: [0, 0, 0], near: 0.01 });
    const zoomed = zoomCamera(camera, -20);
    expect(zoomed.position[2]).toBeLessThan(0.01);
    expect(zoomed.near).toBeLessThan(camera.near);
  });

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
