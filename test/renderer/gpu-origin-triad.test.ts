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
import {
  originTriadDimensions,
  originTriadNominalScale,
  originTriadScale,
} from "../../src/renderer/helpers/gpu-origin-triad";

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

  it("derives nominal scale from complete placed bounds", () => {
    expect(
      originTriadNominalScale({
        minX: -2,
        minY: -1,
        minZ: 0,
        maxX: 2,
        maxY: 1,
        maxZ: 3,
      }),
    ).toBeCloseTo(Math.hypot(4, 2, 3) * 0.12, 8);
  });

  it("caps every positive axis at 56 CSS pixels in perspective", () => {
    const camera = resizeCamera(
      createCamera({
        mode: "perspective",
        position: [0, 0, 10],
        target: [0, 0, 0],
      }),
      800,
      600,
    );

    expect(maxProjectedAxisLength(camera, 10)).toBeLessThanOrEqual(56);
  });

  it("lets a nominal axis shrink when perspective zooms out", () => {
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

    const nominalScale = 1;
    const zoomedOut = variants[1];
    if (zoomedOut === undefined) throw new Error("zoomed-out camera is missing");
    expect(maxProjectedAxisLength(zoomedOut, nominalScale)).toBeLessThan(
      maxProjectedAxisLength(camera, nominalScale),
    );
    for (const variant of variants)
      expect(maxProjectedAxisLength(variant, 10)).toBeLessThanOrEqual(56);
  });

  it("caps orthographic axes independently of zoom, projection, and resize", () => {
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
      expect(maxProjectedAxisLength(variant, 10)).toBeLessThanOrEqual(56);
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
    const scale = originTriadScale(camera, 10);

    expect(projectedAxisLength(camera, [1, 0, 0], scale)).toBeGreaterThan(
      projectedAxisLength(camera, [0, 0, 1], scale),
    );
    expect(maxProjectedAxisLength(camera, 10)).toBeLessThanOrEqual(56);
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

function maxProjectedAxisLength(camera: Camera, nominalScale: number): number {
  return Math.max(
    projectedAxisLength(camera, [1, 0, 0], originTriadScale(camera, nominalScale)),
    projectedAxisLength(camera, [0, 1, 0], originTriadScale(camera, nominalScale)),
    projectedAxisLength(camera, [0, 0, 1], originTriadScale(camera, nominalScale)),
  );
}
