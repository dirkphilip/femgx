import { describe, expect, it, vi } from "vitest";
import { FakeCanvas, pointer, touch, touchControlHarness } from "./support";
import {
  createCamera,
  installCameraControls,
  orbitCamera,
  projectPoint,
  resizeCamera,
} from "@/entries/camera";

import type { Vec3, PointerInput } from "./support";

describe("camera orbit-pan-zoom", () => {
  it("leaves a host-routed touch available for another interaction mode", () => {
    const { canvas, initial, cameraRef, pickPoint, marker, render } = touchControlHarness();

    canvas.dispatch("pointerdown", { ...touch(1, 100, 50), defaultPrevented: true });
    canvas.dispatch("pointermove", touch(1, 130, 50));

    expect(cameraRef.camera).toBe(initial);
    expect(pickPoint).not.toHaveBeenCalled();
    expect(marker).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("keeps incidental one-finger touch movement tap-safe until the drag threshold", async () => {
    const { canvas, initial, cameraRef, pickPoint, marker, render } = touchControlHarness();

    canvas.dispatch("pointerdown", touch(1, 100, 50));
    canvas.dispatch("pointermove", touch(1, 106, 58));
    await Promise.resolve();

    expect(cameraRef.camera).toBe(initial);
    expect(pickPoint).not.toHaveBeenCalled();
    expect(marker).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    canvas.dispatch("pointermove", touch(1, 111, 50));
    await Promise.resolve();

    expect(pickPoint).toHaveBeenCalledOnce();
    expect(marker).toHaveBeenLastCalledWith([1, 0, 0]);
  });

  it.each(["mouse", "touch"] as const)(
    "waits for the picked point before moving a late-resolving %s orbit",
    async (pointerType) => {
      const canvas = new FakeCanvas();
      const initial = resizeCamera(
        createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
        200,
        100,
      );
      const cameraRef = { camera: initial };
      const marker = vi.fn<(pivot: Vec3 | undefined) => void>();
      const render = vi.fn();
      let resolvePivot: ((pivot: Vec3 | undefined) => void) | undefined;
      const pivotPromise = new Promise<Vec3 | undefined>((resolve) => {
        resolvePivot = resolve;
      });
      installCameraControls({
        canvas: canvas as unknown as HTMLCanvasElement,
        cameraRef,
        navigation: {
          pickPoint: (_camera, x, y) => {
            expect([x, y]).toEqual([90, 30]);
            return pivotPromise;
          },
          setOrbitPivot: marker,
        },
        onRender: render,
      });

      const orbitPointer = (x: number, y: number): PointerInput =>
        pointerType === "mouse" ? pointer(x, y) : touch(1, x, y);
      canvas.dispatch("pointerdown", orbitPointer(100, 50));
      canvas.dispatch("pointermove", orbitPointer(130, 65));
      expect(cameraRef.camera).toBe(initial);
      expect(marker).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();

      resolvePivot?.([1, 0, 0]);
      await pivotPromise;
      await Promise.resolve();

      expect(cameraRef.camera).toBe(initial);
      expect(marker).toHaveBeenLastCalledWith([1, 0, 0]);
      expect(render).toHaveBeenCalledOnce();

      canvas.dispatch("pointermove", orbitPointer(145, 75));
      expect(cameraRef.camera).toEqual(orbitCamera(initial, 15 / 180, 10 / 180, [1, 0, 0]));
      expect(render).toHaveBeenCalledTimes(2);
      canvas.dispatch("pointerup", orbitPointer(145, 75));
      expect(marker).toHaveBeenLastCalledWith(undefined);
    },
  );

  it("zooms around the fixed target without issuing a pick", () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    const render = vi.fn();
    const preventDefault = vi.fn();
    const pickPoint = vi.fn(() => Promise.resolve([1, 0, 0] as Vec3));
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: { pickPoint, setOrbitPivot: vi.fn() },
      onRender: render,
    });

    canvas.dispatch("wheel", { clientX: 100, clientY: 50, deltaY: -100, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(pickPoint).not.toHaveBeenCalled();
    expect(cameraRef.camera.position).not.toEqual(initial.position);
    expect(cameraRef.camera.target).toEqual(initial.target);
    expect(projectPoint(cameraRef.camera, initial.target)?.slice(0, 2)).toEqual([100, 50]);
  });

  it("uses current navigation bounds instead of clip planes for zoom safety", async () => {
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
    const bounds = {
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    };
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      bounds: () => bounds,
      navigation: { pickPoint: () => Promise.resolve(undefined), setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("wheel", {
      clientX: 100,
      clientY: 50,
      deltaY: -20_000,
      preventDefault: vi.fn(),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(cameraRef.camera.position[2]).toBeGreaterThan(1);
    expect(cameraRef.camera.near).toBeLessThan(cameraRef.camera.position[2] - 1);
    expect(cameraRef.camera.far).toBeGreaterThan(cameraRef.camera.position[2] + 1);
  });

  it("keeps the fixed wheel target while stopping before the model bounds", () => {
    const canvas = new FakeCanvas();
    const cameraRef = {
      camera: resizeCamera(
        createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
        200,
        100,
      ),
    };
    const pickPoint = vi.fn(() => Promise.resolve([1, 0, 0] as Vec3));
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      bounds: () => ({
        minX: -10,
        minY: -1,
        minZ: -1,
        maxX: 10,
        maxY: 1,
        maxZ: 1,
      }),
      navigation: { pickPoint, setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("wheel", {
      clientX: 100,
      clientY: 50,
      deltaY: -20_000,
      preventDefault: vi.fn(),
    });
    expect(pickPoint).not.toHaveBeenCalled();
    expect(cameraRef.camera.target).toEqual([0, 0, 0]);
    expect(cameraRef.camera.position[2]).toBeGreaterThan(1);
    expect(cameraRef.camera.near).toBeGreaterThan(0);
    expect(cameraRef.camera.far).toBeGreaterThan(cameraRef.camera.near);
  });
});
