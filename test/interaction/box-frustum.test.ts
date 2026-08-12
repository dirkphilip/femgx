import { describe, expect, it } from "vitest";
import { createCamera, unprojectPoint } from "../../src/camera/camera";
import {
  boxSelectionFrustum,
  type BoxSelectionFrustum,
  type FrustumPlane,
} from "../../src/interaction/box-frustum";
import type { BoxSelectionRect } from "../../src/interaction/box-selection";
import { dot, length, type Vec3 } from "../../src/math/vec3";

const perspective = createCamera({
  position: [0, 0, 5],
  target: [0, 0, 0],
  fovY: Math.PI / 2,
  near: 1,
  far: 10,
  width: 800,
  height: 600,
});
const orthographic = createCamera({ ...perspective, mode: "orthographic", orthoHeight: 8 });

function rect(overrides: Partial<BoxSelectionRect> = {}): BoxSelectionRect {
  return {
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    ...overrides,
  };
}

function signedDistance(
  plane: BoxSelectionFrustum[keyof BoxSelectionFrustum],
  point: Vec3,
): number {
  return dot(plane.normal, point) + plane.distance;
}

function pointAtScreen(camera: typeof perspective, x: number, y: number, distance: number): Vec3 {
  const depth =
    camera.mode === "perspective"
      ? (camera.far * (distance - camera.near)) / (distance * (camera.far - camera.near))
      : (distance - camera.near) / (camera.far - camera.near);
  return unprojectPoint(camera, [x, y, depth]);
}

function expectUnitPlanes(frustum: BoxSelectionFrustum): void {
  for (const plane of frustumPlanes(frustum)) expect(length(plane.normal)).toBeCloseTo(1);
}

function frustumPlanes(frustum: BoxSelectionFrustum): readonly FrustumPlane[] {
  return [frustum.left, frustum.right, frustum.top, frustum.bottom, frustum.near, frustum.far];
}

describe("boxSelectionFrustum", () => {
  it.each([perspective, orthographic])(
    "keeps the full camera clip volume inside the %s frustum",
    (camera) => {
      const frustum = boxSelectionFrustum(camera, rect());
      const center = pointAtScreen(camera, 400, 300, 5);
      expect(frustumPlanes(frustum).every((plane) => signedDistance(plane, center) >= -1e-6)).toBe(
        true,
      );
      expect(
        signedDistance(frustum.near, pointAtScreen(camera, 400, 300, camera.near)),
      ).toBeCloseTo(0);
      expect(signedDistance(frustum.far, pointAtScreen(camera, 400, 300, camera.far))).toBeCloseTo(
        0,
      );
      expectUnitPlanes(frustum);
    },
  );

  it("orients perspective side planes toward the selected rectangle", () => {
    const frustum = boxSelectionFrustum(
      perspective,
      rect({ left: 200, top: 150, right: 600, bottom: 450 }),
    );
    const inside = pointAtScreen(perspective, 400, 300, 5);
    expect(frustumPlanes(frustum).every((plane) => signedDistance(plane, inside) >= -1e-6)).toBe(
      true,
    );
    expect(signedDistance(frustum.left, pointAtScreen(perspective, 100, 300, 5))).toBeLessThan(0);
    expect(signedDistance(frustum.right, pointAtScreen(perspective, 700, 300, 5))).toBeLessThan(0);
    expect(signedDistance(frustum.top, pointAtScreen(perspective, 400, 50, 5))).toBeLessThan(0);
    expect(signedDistance(frustum.bottom, pointAtScreen(perspective, 400, 550, 5))).toBeLessThan(0);
    expectUnitPlanes(frustum);
    expect(signedDistance(frustum.left, perspective.position)).toBeCloseTo(0);
    expect(signedDistance(frustum.right, perspective.position)).toBeCloseTo(0);
  });

  it("keeps orthographic side planes parallel and camera-independent", () => {
    const frustum = boxSelectionFrustum(
      orthographic,
      rect({ left: 200, top: 150, right: 600, bottom: 450 }),
    );
    expect(dot(frustum.left.normal, frustum.right.normal)).toBeCloseTo(-1);
    expect(dot(frustum.top.normal, frustum.bottom.normal)).toBeCloseTo(-1);
    expect(signedDistance(frustum.left, pointAtScreen(orthographic, 100, 300, 5))).toBeLessThan(0);
    expect(signedDistance(frustum.right, pointAtScreen(orthographic, 700, 300, 5))).toBeLessThan(0);
    expectUnitPlanes(frustum);
  });

  it("normalizes reversed and partially out-of-range rectangles", () => {
    const reversed = boxSelectionFrustum(
      perspective,
      rect({ left: 600, top: 450, right: 200, bottom: 150, width: -400, height: -300 }),
    );
    const normal = boxSelectionFrustum(
      perspective,
      rect({ left: 200, top: 150, right: 600, bottom: 450 }),
    );
    expect(reversed).toEqual(normal);
    expect(
      boxSelectionFrustum(perspective, rect({ left: -100, top: -50, right: 900, bottom: 700 })),
    ).toEqual(boxSelectionFrustum(perspective, rect()));
  });

  it("rejects non-finite or empty rectangles without mutating the input", () => {
    const input = rect({ left: 100, top: 50, right: 700, bottom: 550 });
    const snapshot = { ...input };
    boxSelectionFrustum(perspective, input);
    expect(input).toEqual(snapshot);
    expect(() => boxSelectionFrustum(perspective, rect({ left: Number.NaN }))).toThrow(TypeError);
    expect(() =>
      boxSelectionFrustum(perspective, rect({ width: Number.POSITIVE_INFINITY })),
    ).toThrow(TypeError);
    expect(() =>
      boxSelectionFrustum(perspective, rect({ left: -20, right: -1, top: 10, bottom: 20 })),
    ).toThrow(RangeError);
    expect(() =>
      boxSelectionFrustum(perspective, rect({ left: 20, right: 20, top: 10, bottom: 20 })),
    ).toThrow(RangeError);
  });
});
