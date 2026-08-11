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

  it.each([
    { name: "mode", options: { mode: "invalid" as never }, message: "mode" },
    { name: "position", options: { position: [NaN, 0, 1] }, message: "position" },
    { name: "target", options: { target: [0, Infinity, 0] }, message: "target" },
    {
      name: "equal position and target",
      options: { position: [0, 0, 0], target: [0, 0, 0] },
      message: "distinct",
    },
    { name: "zero up", options: { up: [0, 0, 0] }, message: "non-zero" },
    {
      name: "parallel up",
      options: { position: [0, 0, 1], target: [0, 0, 0], up: [0, 0, 1] },
      message: "parallel",
    },
    { name: "fovY", options: { fovY: 0 }, message: "fovY" },
    { name: "non-finite fovY", options: { fovY: Infinity }, message: "fovY" },
    { name: "near", options: { near: 0 }, message: "near/far" },
    { name: "non-finite near", options: { near: NaN }, message: "near" },
    { name: "far", options: { near: 2, far: 1 }, message: "near/far" },
    { name: "non-finite far", options: { far: Infinity }, message: "far" },
    { name: "orthoHeight", options: { orthoHeight: 0 }, message: "orthoHeight" },
    { name: "non-finite orthoHeight", options: { orthoHeight: Infinity }, message: "orthoHeight" },
    { name: "width", options: { width: 0 }, message: "width and height" },
    { name: "non-finite width", options: { width: Infinity }, message: "width" },
    { name: "height", options: { height: NaN }, message: "height" },
  ] as const)("rejects invalid camera state: $name", ({ options, message }) => {
    expect(() => createCamera(options)).toThrow(new RegExp(message));
  });

  it("rejects non-finite transition inputs and resize dimensions", () => {
    const camera = createCamera();
    expect(() => orbitCamera(camera, NaN, 0)).toThrow(/orbit yaw/);
    expect(() => orbitCamera(camera, 0, 0, [Infinity, 0, 0])).toThrow(/orbit pivot/);
    expect(() => panCamera(camera, 0, Infinity)).toThrow(/pan vertical/);
    expect(() => zoomCamera(camera, NaN)).toThrow(/zoom amount/);
    expect(() => zoomCameraAtPoint(camera, 0, [0, NaN, 0])).toThrow(/zoom pivot/);
    expect(() => resizeCamera(camera, NaN, 100)).toThrow(/width/);
    expect(() => resizeCamera(camera, 100, Infinity)).toThrow(/height/);
    expect(resizeCamera(camera, 0, -1)).toMatchObject({ width: 1, height: 1 });
  });

  it("accepts a valid non-default camera without changing its values", () => {
    const camera = createCamera({
      mode: "orthographic",
      position: [4, 3, 7],
      target: [1, 0, 0],
      up: [0, 1, 0],
      fovY: 1,
      near: 0.2,
      far: 500,
      orthoHeight: 12,
      width: 800,
      height: 600,
    });
    expect(camera).toMatchObject({ mode: "orthographic", near: 0.2, far: 500, width: 800 });
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

  it("does not use clip planes as a perspective distance clamp", () => {
    const camera = createCamera({ position: [0, 0, 1], target: [0, 0, 0], near: 0.01, far: 100 });
    const zoomed = zoomCamera(camera, -20);
    expect(zoomed.position[2]).toBeCloseTo(Math.exp(-20));
    expect(zoomed.near).toBe(camera.near);
    expect(zoomed.far).toBe(camera.far);
  });

  it("round-trips non-clamped perspective zoom", () => {
    const camera = createCamera({ position: [0, 0, 10], target: [0, 0, 0], near: 0.1, far: 100 });
    const zoomed = zoomCamera(camera, 0.4);
    const restored = zoomCamera(zoomed, -0.4);
    expect(restored.position[2]).toBeCloseTo(camera.position[2]);
    expect(restored.target).toEqual(camera.target);
    expect(restored.near).toBe(camera.near);
    expect(restored.far).toBe(camera.far);
  });

  it("round-trips non-clamped cursor-centered perspective zoom", () => {
    const camera = createCamera({
      position: [4, 3, 10],
      target: [1, 0, 0],
      near: 0.1,
      far: 100,
    });
    const pivot = [0.4, -0.2, 0.7] as const;
    const zoomed = zoomCameraAtPoint(camera, 0.4, pivot);
    const restored = zoomCameraAtPoint(zoomed, -0.4, pivot);
    expect(restored.position[0]).toBeCloseTo(camera.position[0]);
    expect(restored.position[1]).toBeCloseTo(camera.position[1]);
    expect(restored.position[2]).toBeCloseTo(camera.position[2]);
    expect(restored.target[0]).toBeCloseTo(camera.target[0]);
    expect(restored.target[1]).toBeCloseTo(camera.target[1]);
    expect(restored.target[2]).toBeCloseTo(camera.target[2]);
    expect(restored.near).toBe(camera.near);
    expect(restored.far).toBe(camera.far);
  });

  it("allows cursor-centered zoom beyond the configured clip interval", () => {
    const camera = createCamera({ position: [0, 0, 10], target: [0, 0, 0], near: 0.1, far: 100 });
    const pivot = [2, 0, 0] as const;
    const directNear = zoomCamera(camera, -20);
    const directFar = zoomCamera(camera, 20);
    const near = zoomCameraAtPoint(camera, -20, pivot);
    const far = zoomCameraAtPoint(camera, 20, pivot);
    expect(distance(directNear.position, directNear.target)).toBeCloseTo(10 * Math.exp(-20));
    expect(distance(directFar.position, directFar.target)).toBeCloseTo(10 * Math.exp(20));
    expect(distance(near.position, near.target)).toBeCloseTo(10 * Math.exp(-20));
    expect(distance(far.position, far.target)).toBeCloseTo(10 * Math.exp(20));
    expect(near.near).toBe(camera.near);
    expect(near.far).toBe(camera.far);
    expect(far.near).toBe(camera.near);
    expect(far.far).toBe(camera.far);
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

  it.each(["perspective", "orthographic"] as const)(
    "keeps target-plane fallback anchors under their screen points in %s mode",
    (mode) => {
      const camera = setProjection(
        resizeCamera(
          createCamera({ position: [4, 3, 7], target: [0, 0, 0], near: 0.1, far: 100 }),
          973,
          611,
        ),
        mode,
      );
      const before = JSON.stringify(camera);
      const positions: readonly (readonly [number, number])[] = [
        [486.5, 305.5],
        [80, 90],
        [890, 540],
        [950, 40],
      ];
      for (const [x, y] of positions) {
        const targetScreen = projectPoint(camera, camera.target);
        expect(targetScreen).toBeDefined();
        const anchor = unprojectPoint(camera, [x, y, targetScreen?.[2] ?? NaN]);
        expect(projectPoint(camera, anchor)?.slice(0, 2)).toEqual([
          expect.closeTo(x),
          expect.closeTo(y),
        ]);
        const zoomed = zoomCameraAtPoint(camera, -0.2, anchor);
        const projected = projectPoint(zoomed, anchor);
        expect(projected?.[0]).toBeCloseTo(x, 4);
        expect(projected?.[1]).toBeCloseTo(y, 4);
      }
      expect(JSON.stringify(camera)).toBe(before);
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
