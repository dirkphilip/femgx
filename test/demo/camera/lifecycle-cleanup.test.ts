import { describe, expect, it, vi } from "vitest";
import { FakeCanvas, pointer } from "./support";
import { createCamera, installCameraControls, resizeCamera } from "../../../src/entries/camera";

import type { Vec3 } from "./support";

describe("camera lifecycle-cleanup", () => {
  it("ignores a picked pivot that resolves after orbit cancellation", async () => {
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
      navigation: { pickPoint: () => pivotPromise, setOrbitPivot: marker },
      onRender: render,
    });

    canvas.dispatch("pointerdown", pointer(100, 50));
    canvas.dispatch("pointercancel", pointer(100, 50));
    resolvePivot?.([1, 0, 0]);
    await pivotPromise;
    await Promise.resolve();

    expect(cameraRef.camera).toBe(initial);
    expect(marker).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("clears the orbit widget when the pointer gesture ends", async () => {
    const canvas = new FakeCanvas();
    const cameraRef = {
      camera: resizeCamera(
        createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
        200,
        100,
      ),
    };
    const marker = vi.fn<(pivot: Vec3 | undefined) => void>();
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: {
        pickPoint: () => Promise.resolve([1, 0, 0] as Vec3),
        setOrbitPivot: marker,
      },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", pointer(100, 50));
    await Promise.resolve();
    expect(marker).toHaveBeenLastCalledWith([1, 0, 0]);
    canvas.dispatch("pointermove", pointer(130, 65));
    canvas.dispatch("pointerup", pointer(130, 65));
    await Promise.resolve();

    expect(marker).toHaveBeenLastCalledWith(undefined);
  });
});
