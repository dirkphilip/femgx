import { describe, expect, it, vi } from "vitest";
import {
  createCamera,
  installCameraControls,
  panCamera,
  projectPoint,
  resizeCamera,
  setProjection,
  zoomCamera,
  type Vec3,
} from "../../src";
import { cameraKeyLightDirection } from "../../src/renderer/gpu-frame";

interface PointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
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
  metaKey: false,
  clientX,
  clientY,
});

const touch = (pointerId: number, clientX: number, clientY: number): PointerInput => ({
  ...pointer(clientX, clientY),
  pointerId,
  pointerType: "touch",
  button: 0,
});

describe("camera controls", () => {
  it("keeps a moving orbit continuous when its picked point resolves late", async () => {
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

    canvas.dispatch("pointerdown", pointer(100, 50));
    canvas.dispatch("pointermove", pointer(130, 65));
    expect(cameraRef.camera).not.toBe(initial);
    expect(marker).toHaveBeenLastCalledWith(initial.target);
    const movingCamera = cameraRef.camera;
    const renderCount = render.mock.calls.length;

    resolvePivot?.([1, 0, 0]);
    await pivotPromise;
    await Promise.resolve();

    expect(cameraRef.camera).toBe(movingCamera);
    expect(cameraRef.camera.target).toEqual(initial.target);
    expect(marker).toHaveBeenLastCalledWith(initial.target);
    expect(marker).not.toHaveBeenCalledWith([1, 0, 0]);
    expect(render).toHaveBeenCalledTimes(renderCount);

    canvas.dispatch("pointermove", pointer(145, 75));
    expect(cameraRef.camera).not.toBe(movingCamera);
    canvas.dispatch("pointerup", pointer(145, 75));
    expect(marker).toHaveBeenLastCalledWith(undefined);
  });

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

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
