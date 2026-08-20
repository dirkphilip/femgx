import { describe, expect, it, vi } from "vitest";
import { FakeCanvas, pointer, distance } from "./support";
import {
  createCamera,
  installCameraControls,
  projectPoint,
  resizeCamera,
  setProjection,
} from "@/entries/camera";
import { cameraKeyLightDirection } from "@/renderer/frame/frame";
import type { Vec3 } from "./support";

describe("camera framing-transitions", () => {
  it("uses current navigation bounds for immediate orbit safety", async () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({
        mode: "perspective",
        position: [0, 0, 5],
        target: [0, 0, 0],
        near: 0.01,
        far: 1000,
      }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    const bounds = {
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    };
    const getBounds = vi.fn(() => bounds);
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      bounds: getBounds,
      navigation: { pickPoint: () => Promise.resolve(undefined), setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", pointer(100, 50));
    await Promise.resolve();
    canvas.dispatch("pointermove", pointer(280, 50));

    expect(getBounds).toHaveBeenCalledTimes(2);
    expect(cameraRef.camera.far).toBeLessThan(initial.far);
    expect(cameraRef.camera.near).toBeGreaterThan(0);
    expect(distance(cameraRef.camera.position, cameraRef.camera.target)).toBeCloseTo(
      distance(initial.position, initial.target),
    );
    expect(cameraRef.camera.target).toEqual([0, 0, 0]);
  });

  it("does not recenter the camera on the picked pivot at first movement", async () => {
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
      navigation: {
        pickPoint: () => Promise.resolve([1, 0, 0]),
        setOrbitPivot: vi.fn(),
      },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", pointer(100, 50));
    await Promise.resolve();
    canvas.dispatch("pointermove", pointer(101, 50));

    expect(distance(cameraRef.camera.target, initial.target)).toBeLessThan(0.01);
    expect(cameraRef.camera.target).not.toEqual([1, 0, 0]);
  });

  it.each(["perspective", "orthographic"] as const)(
    "pans target-plane content at CSS-pixel pace in %s projection",
    (mode) => {
      const canvas = new FakeCanvas();
      const initial = setProjection(
        resizeCamera(
          createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
          200,
          100,
        ),
        mode,
      );
      const cameraRef = { camera: initial };
      installCameraControls({
        canvas: canvas as unknown as HTMLCanvasElement,
        cameraRef,
        navigation: { pickPoint: vi.fn(), setOrbitPivot: vi.fn() },
        onRender: vi.fn(),
      });
      const anchor: Vec3 = [1, 0.5, 0];
      const before = projectPoint(initial, anchor);

      canvas.dispatch("pointerdown", { ...pointer(100, 50), ctrlKey: true });
      canvas.dispatch("pointermove", { ...pointer(130, 35), ctrlKey: true });

      const after = projectPoint(cameraRef.camera, anchor);
      expect(after?.[0]).toBeCloseTo((before?.[0] ?? NaN) + 30, 4);
      expect(after?.[1]).toBeCloseTo((before?.[1] ?? NaN) - 15, 4);
      expect(cameraRef.camera.up).toEqual(initial.up);
      expect(cameraRef.camera.near).toBe(initial.near);
      expect(cameraRef.camera.far).toBe(initial.far);
      expect(cameraRef.camera.fovY).toBe(initial.fovY);
      expect(cameraRef.camera.orthoHeight).toBe(initial.orthoHeight);
      expect(cameraKeyLightDirection(cameraRef.camera)).toEqual(cameraKeyLightDirection(initial));
      expect(distance(cameraRef.camera.position, cameraRef.camera.target)).toBeCloseTo(
        distance(initial.position, initial.target),
      );
    },
  );
});
