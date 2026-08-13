import { describe, expect, it } from "vitest";
import {
  createCamera,
  projectPoint,
  resizeCamera,
  setProjection,
  type Camera,
  zoomCamera,
  zoomCameraAtPoint,
} from "../../src/camera/camera";
import { originTriadDimensions, originTriadScale } from "../../src/renderer/gpu-origin-triad";

describe("world-origin triad", () => {
  it("derives finite dimensions from one camera scale", () => {
    expect(originTriadDimensions(10)).toEqual({
      scale: 10,
      shaftRadius: 0.25,
      arrowLength: 2.2,
      arrowWidth: 1.2,
      hubRadius: 0.6,
    });
    expect(originTriadDimensions(Number.NaN).scale).toBeGreaterThan(0);
  });

  it("keeps a camera-plane axis at 56 CSS pixels in perspective", () => {
    const camera = resizeCamera(
      createCamera({
        mode: "perspective",
        position: [0, 0, 10],
        target: [0, 0, 0],
      }),
      800,
      600,
    );

    expect(projectedAxisLength(camera, [0, 1, 0])).toBeCloseTo(56, 4);
  });

  it("preserves the CSS-pixel length through perspective depth changes", () => {
    const camera = resizeCamera(
      createCamera({
        mode: "perspective",
        position: [0, 0, 10],
        target: [0, 0, 0],
      }),
      800,
      600,
    );
    const variants = [
      zoomCamera(camera, -0.8),
      zoomCamera(camera, 0.8),
      zoomCameraAtPoint(camera, -0.5, [2, 0, 0]),
    ];

    for (const variant of variants) {
      expect(projectedAxisLength(variant, [0, 1, 0])).toBeCloseTo(56, 4);
    }
  });

  it("preserves the CSS-pixel length through orthographic zoom, projection, and resize", () => {
    const perspective = resizeCamera(
      createCamera({
        mode: "perspective",
        position: [0, 0, 10],
        target: [0, 0, 0],
      }),
      800,
      600,
    );
    const orthographic = setProjection(perspective, "orthographic");

    for (const variant of [
      orthographic,
      zoomCamera(orthographic, -0.8),
      zoomCamera(orthographic, 0.8),
      resizeCamera(orthographic, 1200, 900),
    ]) {
      expect(projectedAxisLength(variant, [0, 1, 0])).toBeCloseTo(56, 4);
    }
  });

  it("retains normal world-axis foreshortening", () => {
    const camera = resizeCamera(
      createCamera({
        mode: "perspective",
        position: [0, 0, 10],
        target: [0, 0, 0],
      }),
      800,
      600,
    );
    const scale = originTriadScale(camera);

    expect(projectedAxisLength(camera, [1, 0, 0], scale)).toBeCloseTo(56, 4);
    expect(projectedAxisLength(camera, [0, 0, 1], scale)).toBeCloseTo(0, 8);
  });

  it.each([
    createCamera({
      mode: "perspective",
      position: [0, 0, 0.001],
      target: [0, 0, -1],
      near: 0.01,
    }),
    createCamera({ mode: "perspective", position: [0, 0, -1], target: [0, 0, -2] }),
    createCamera({ mode: "orthographic", orthoHeight: 1e-9 }),
  ])("keeps near, behind-camera, and tiny-scale configurations finite", (camera) => {
    const scale = originTriadScale(camera);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(0);
  });
});

function projectedAxisLength(
  camera: Camera,
  axis: readonly [number, number, number],
  scale = originTriadScale(camera),
): number {
  const origin = projectPoint(camera, [0, 0, 0]);
  const endpoint = projectPoint(camera, [axis[0] * scale, axis[1] * scale, axis[2] * scale]);
  if (origin === undefined || endpoint === undefined) return Number.NaN;
  return Math.hypot(endpoint[0] - origin[0], endpoint[1] - origin[1]);
}
