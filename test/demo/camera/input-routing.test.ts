import { describe, expect, it, vi } from "vitest";
import { FakeCanvas, pointer, touch, distance } from "./support";
import {
  createCamera,
  installCameraControls,
  panCamera,
  projectPoint,
  resizeCamera,
  zoomCamera,
} from "@/entries/camera";

import type { Vec3 } from "./support";

describe("camera input-routing", () => {
  it("keeps mouse pan pace after zoom and composes multiple events", () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      zoomCamera(createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }), -1),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    const render = vi.fn();
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: { pickPoint: vi.fn(), setOrbitPivot: vi.fn() },
      onRender: render,
    });
    const anchor: Vec3 = [1, 0, 0];
    const before = projectPoint(initial, anchor);

    canvas.dispatch("pointerdown", { ...pointer(100, 50), metaKey: true });
    canvas.dispatch("pointermove", { ...pointer(110, 60), metaKey: true });
    canvas.dispatch("pointermove", { ...pointer(130, 50), metaKey: true });

    const after = projectPoint(cameraRef.camera, anchor);
    expect(after?.[0]).toBeCloseTo((before?.[0] ?? NaN) + 30, 4);
    expect(after?.[1]).toBeCloseTo(before?.[1] ?? NaN, 4);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("keeps a zero mouse pan immutable and render-free", () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(createCamera(), 200, 100);
    const cameraRef = { camera: initial };
    const render = vi.fn();
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: { pickPoint: vi.fn(), setOrbitPivot: vi.fn() },
      onRender: render,
    });

    canvas.dispatch("pointerdown", { ...pointer(100, 50), ctrlKey: true });
    canvas.dispatch("pointermove", { ...pointer(100, 50), ctrlKey: true });

    expect(cameraRef.camera).toBe(initial);
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    ["Control", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
  ])("pans the scene right with %s+middle drag", (_modifier, modifiers) => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    const pickPoint = vi.fn(() => Promise.resolve(undefined));
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: { pickPoint, setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", { ...pointer(100, 50), ...modifiers });
    canvas.dispatch("pointermove", { ...pointer(130, 50), ...modifiers });

    expect(projectPoint(cameraRef.camera, [1, 0, 0])?.[0]).toBeCloseTo(
      (projectPoint(initial, [1, 0, 0])?.[0] ?? NaN) + 30,
      4,
    );
    expect(projectPoint(cameraRef.camera, [1, 0, 0])?.[1]).toBeCloseTo(
      projectPoint(initial, [1, 0, 0])?.[1] ?? NaN,
      4,
    );
    expect(pickPoint).not.toHaveBeenCalled();
  });

  it("keeps the fixed target for Shift+middle drag", () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    const pickPoint = vi.fn(() => Promise.resolve([1, 0, 0] as Vec3));
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: { pickPoint, setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", { ...pointer(100, 50), shiftKey: true });
    canvas.dispatch("pointermove", { ...pointer(100, 80), shiftKey: true });
    expect(cameraRef.camera).not.toBe(initial);
    expect(pickPoint).not.toHaveBeenCalled();
    expect(cameraRef.camera.target).toEqual(initial.target);
    const projected = projectPoint(cameraRef.camera, initial.target);
    expect(projected?.[0]).toBeCloseTo(100, 5);
    expect(projected?.[1]).toBeCloseTo(50, 5);
  });

  it("keeps the panned view target fixed during pinch zoom", () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: { pickPoint: vi.fn(() => Promise.resolve(undefined)), setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", touch(1, 50, 50));
    canvas.dispatch("pointerdown", touch(2, 150, 50));
    canvas.dispatch("pointermove", touch(1, 40, 70));
    const beforeFinalZoom = cameraRef.camera;
    const worldUnitsPerPixel =
      (2 *
        distance(beforeFinalZoom.position, beforeFinalZoom.target) *
        Math.tan(beforeFinalZoom.fovY / 2)) /
      beforeFinalZoom.height;
    const afterPan = panCamera(beforeFinalZoom, 15 * worldUnitsPerPixel, 10 * worldUnitsPerPixel);
    canvas.dispatch("pointermove", touch(2, 180, 70));

    expect(cameraRef.camera.target).toEqual(afterPan.target);
    expect(distance(cameraRef.camera.position, cameraRef.camera.target)).toBeLessThan(
      distance(beforeFinalZoom.position, beforeFinalZoom.target),
    );
    expect(cameraRef.camera).not.toBe(initial);
  });

  it("uses bounds safety for Shift+middle zoom as well as the wheel", () => {
    const canvas = new FakeCanvas();
    const cameraRef = {
      camera: resizeCamera(
        createCamera({
          mode: "perspective",
          position: [0, 0, 5],
          target: [0, 0, 0],
          near: 0.01,
          far: 8,
        }),
        200,
        100,
      ),
    };
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      bounds: () => ({
        minX: -1,
        minY: -1,
        minZ: -1,
        maxX: 1,
        maxY: 1,
        maxZ: 1,
      }),
      navigation: { pickPoint: () => Promise.resolve(undefined), setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", { ...pointer(100, 50), shiftKey: true });
    canvas.dispatch("pointermove", { ...pointer(100, -10_000), shiftKey: true });

    expect(cameraRef.camera.position[2]).toBeGreaterThan(1);
    expect(cameraRef.camera.near).toBeLessThan(cameraRef.camera.position[2] - 1);
    expect(cameraRef.camera.far).toBeGreaterThan(cameraRef.camera.position[2] + 1);
  });
});
