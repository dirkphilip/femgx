import { describe, expect, it } from "vitest";
import { createCamera, projectPoint, type Camera, type Vec3 } from "../../src/camera/camera";
import { fitCamera } from "../../src/camera/fit";
import type { Bounds } from "../../src/geometry/part";

const bounds: Bounds = { minX: -2, minY: -1, minZ: -3, maxX: 4, maxY: 3, maxZ: 2 };

describe("fitCamera", () => {
  it.each(["perspective", "orthographic"] as const)(
    "fits every corner in the framed viewport for %s projection",
    (mode) => {
      const camera = fitCamera(createCamera({ mode }), bounds, 1152, 900);
      const projected = boundsCorners(bounds).map((corner) => projectPoint(camera, corner));
      expect(projected.every((point) => point !== undefined)).toBe(true);
      for (const point of projected) {
        if (point === undefined) continue;
        expect(point[0]).toBeGreaterThanOrEqual(1152 * 0.049);
        expect(point[0]).toBeLessThanOrEqual(1152 * 0.951);
        expect(point[1]).toBeGreaterThanOrEqual(900 * 0.049);
        expect(point[1]).toBeLessThanOrEqual(900 * 0.951);
        expect(point[2]).toBeGreaterThan(0);
        expect(point[2]).toBeLessThan(1);
      }
    },
  );

  it("preserves orientation and uses the available frame for a wide model", () => {
    const initial = createCamera({ position: [3, 3, 5], target: [0, 0, 0] });
    const fitted = fitCamera(
      initial,
      { minX: -20, minY: -1, minZ: -1, maxX: 20, maxY: 1, maxZ: 1 },
      1152,
      900,
    );
    expect(direction(fitted)).toEqual(direction(initial));
    const projected = boundsCorners({ minX: -20, minY: -1, minZ: -1, maxX: 20, maxY: 1, maxZ: 1 })
      .map((corner) => projectPoint(fitted, corner))
      .filter((point): point is readonly [number, number, number] => point !== undefined);
    expect(Math.max(...projected.map((point) => point[0]))).toBeGreaterThan(1152 * 0.85);
  });

  it.each([
    { name: "tall", value: { minX: -1, minY: -20, minZ: -1, maxX: 1, maxY: 20, maxZ: 1 } },
    { name: "flat", value: { minX: -3, minY: -2, minZ: 0, maxX: 3, maxY: 2, maxZ: 0 } },
    { name: "line", value: { minX: -10, minY: 0, minZ: 0, maxX: 10, maxY: 0, maxZ: 0 } },
    { name: "point", value: { minX: 2, minY: 2, minZ: 2, maxX: 2, maxY: 2, maxZ: 2 } },
  ])("keeps $name bounds finite in a mobile viewport", ({ value }) => {
    for (const mode of ["perspective", "orthographic"] as const) {
      const fitted = fitCamera(createCamera({ mode }), value, 375, 608);
      expect(
        [...fitted.position, ...fitted.target, fitted.near, fitted.far, fitted.orthoHeight].every(
          Number.isFinite,
        ),
      ).toBe(true);
      expect(fitted.near).toBeGreaterThan(0);
      expect(fitted.far).toBeGreaterThan(fitted.near);
      expect(projectPoint(fitted, [value.minX, value.minY, value.minZ])).toBeDefined();
    }
  });
});

function direction(camera: Camera): Vec3 {
  const x = camera.target[0] - camera.position[0];
  const y = camera.target[1] - camera.position[1];
  const z = camera.target[2] - camera.position[2];
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function boundsCorners(value: Bounds): readonly Vec3[] {
  return [
    [value.minX, value.minY, value.minZ],
    [value.minX, value.minY, value.maxZ],
    [value.minX, value.maxY, value.minZ],
    [value.minX, value.maxY, value.maxZ],
    [value.maxX, value.minY, value.minZ],
    [value.maxX, value.minY, value.maxZ],
    [value.maxX, value.maxY, value.minZ],
    [value.maxX, value.maxY, value.maxZ],
  ];
}
