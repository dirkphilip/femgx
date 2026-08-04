import { describe, expect, it } from "vitest";
import { createCamera, resizeCamera } from "../../src/camera/camera";
import { projectPolygon } from "../../src/camera/project-polygon";

describe("projectPolygon", () => {
  const camera = resizeCamera(
    createCamera({ position: [0, 0, 0], target: [0, 0, -1], near: 1, far: 100 }),
    800,
    600,
  );

  it("projects a fully visible polygon to screen points", () => {
    const screen = projectPolygon(camera, [
      [-1, -1, -5],
      [1, -1, -5],
      [1, 1, -5],
      [-1, 1, -5],
    ]);
    expect(screen).toHaveLength(4);
    for (const point of screen) {
      expect(Number.isFinite(point[0])).toBe(true);
      expect(Number.isFinite(point[1])).toBe(true);
    }
  });

  it("clips a polygon straddling the camera plane instead of dropping it", () => {
    const screen = projectPolygon(camera, [
      [0, 0, 2],
      [-2, 0, -5],
      [2, 0, -5],
      [0, 2, -5],
    ]);
    expect(screen.length).toBeGreaterThanOrEqual(3);
    for (const point of screen) {
      expect(Number.isFinite(point[0])).toBe(true);
      expect(Number.isFinite(point[1])).toBe(true);
      expect(Number.isFinite(point[2])).toBe(true);
    }
  });

  it("returns an empty polygon when everything is behind the camera", () => {
    expect(
      projectPolygon(camera, [
        [0, 0, 1],
        [1, 0, 1],
        [0, 1, 1],
      ]),
    ).toHaveLength(0);
  });

  it("clips vertices closer than the near plane", () => {
    const screen = projectPolygon(camera, [
      [0, 0, -0.5],
      [1, 0, -5],
      [0, 1, -5],
    ]);
    expect(screen.length).toBeGreaterThanOrEqual(3);
    for (const point of screen) {
      expect(point[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(point[2]).toBeLessThanOrEqual(1);
    }
  });
});
