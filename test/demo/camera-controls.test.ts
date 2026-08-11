import { describe, expect, it, vi } from "vitest";
import { createCamera, installCameraControls, resizeCamera, type Vec3 } from "../../src";

interface PointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly clientX: number;
  readonly clientY: number;
}

interface WheelInput {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaY: number;
  readonly preventDefault: () => void;
}

class FakeCanvas {
  private readonly listeners = new Map<string, (event: PointerEvent) => void>();
  private readonly captures = new Set<number>();

  getBoundingClientRect(): DOMRect {
    return { left: 10, top: 20, width: 200, height: 100 } as DOMRect;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener as (event: PointerEvent) => void);
  }

  dispatch(type: string, event: PointerInput | WheelInput): void {
    this.listeners.get(type)?.(event as PointerEvent);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captures.has(pointerId);
  }

  setPointerCapture(pointerId: number): void {
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captures.delete(pointerId);
  }
}

const pointer = (clientX: number, clientY: number): PointerInput => ({
  pointerId: 1,
  pointerType: "mouse",
  button: 1,
  shiftKey: false,
  ctrlKey: false,
  clientX,
  clientY,
});

describe("camera controls", () => {
  it("queues an early drag until the picked orbit point resolves", async () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ position: [0, 0, 5], target: [0, 0, 0] }),
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

    canvas.dispatch("pointerdown", pointer(100, 50));
    canvas.dispatch("pointermove", pointer(130, 65));
    canvas.dispatch("pointerup", pointer(130, 65));
    expect(cameraRef.camera).toBe(initial);

    resolvePivot?.([1, 0, 0]);
    await pivotPromise;
    await Promise.resolve();

    expect(marker).toHaveBeenCalledWith(undefined);
    expect(render).toHaveBeenCalledTimes(2);
    expect(cameraRef.camera).not.toBe(initial);
    expect(distance(cameraRef.camera.position, [1, 0, 0])).toBeCloseTo(
      distance(initial.position, [1, 0, 0]),
    );
  });

  it("zooms around the world point under the mouse", async () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ position: [0, 0, 5], target: [0, 0, 0] }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    const render = vi.fn();
    const preventDefault = vi.fn();
    const pivot: Vec3 = [1, 0, 0];
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: {
        pickPoint: (_camera, x, y) => {
          expect([x, y]).toEqual([90, 30]);
          return Promise.resolve(pivot);
        },
        setOrbitPivot: vi.fn(),
      },
      onRender: render,
    });

    canvas.dispatch("wheel", { clientX: 100, clientY: 50, deltaY: -100, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(render).toHaveBeenCalledOnce();
    expect(cameraRef.camera.position).not.toEqual(initial.position);
  });

  it("clears the orbit widget when the pointer gesture ends", async () => {
    const canvas = new FakeCanvas();
    const cameraRef = {
      camera: resizeCamera(createCamera({ position: [0, 0, 5], target: [0, 0, 0] }), 200, 100),
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

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
