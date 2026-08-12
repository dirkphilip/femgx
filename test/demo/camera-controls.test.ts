import { describe, expect, it, vi } from "vitest";
import {
  createCamera,
  installCameraControls,
  panCamera,
  projectPoint,
  resizeCamera,
  unprojectPoint,
  type Vec3,
} from "../../src";

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
    expect(render).toHaveBeenCalledOnce();
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

  it.each(["miss", "rejection"] as const)(
    "anchors wheel zoom on the target plane after a pick %s",
    async (pickResult) => {
      const canvas = new FakeCanvas();
      const initial = resizeCamera(
        createCamera({ position: [0, 0, 5], target: [0, 0, 0] }),
        200,
        100,
      );
      const cameraRef = { camera: initial };
      installCameraControls({
        canvas: canvas as unknown as HTMLCanvasElement,
        cameraRef,
        navigation: {
          pickPoint: () =>
            pickResult === "miss"
              ? Promise.resolve(undefined)
              : Promise.reject(new Error("device lost")),
          setOrbitPivot: vi.fn(),
        },
        onRender: vi.fn(),
      });

      const point = { x: 90, y: 30 };
      const targetDepth = projectPoint(initial, initial.target)?.[2] ?? NaN;
      const anchor = unprojectPoint(initial, [point.x, point.y, targetDepth]);
      canvas.dispatch("wheel", {
        clientX: 100,
        clientY: 50,
        deltaY: -100,
        preventDefault: vi.fn(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const projected = projectPoint(cameraRef.camera, anchor);
      expect(projected?.[0]).toBeCloseTo(point.x, 5);
      expect(projected?.[1]).toBeCloseTo(point.y, 5);
      expect(cameraRef.camera.target).not.toEqual(initial.target);
    },
  );

  it("uses current navigation bounds instead of clip planes for zoom safety", async () => {
    const canvas = new FakeCanvas();
    const cameraRef = {
      camera: resizeCamera(
        createCamera({ position: [0, 0, 5], target: [0, 0, 0], near: 0.01, far: 8 }),
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

  it("uses current navigation bounds for immediate orbit safety", async () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ position: [0, 0, 5], target: [0, 0, 0], near: 0.01, far: 1000 }),
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

    expect(getBounds).toHaveBeenCalledOnce();
    expect(cameraRef.camera.far).toBeLessThan(initial.far);
    expect(cameraRef.camera.near).toBeGreaterThan(0);
  });

  it("applies queued orbit deltas with the live bounds supplier", async () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ position: [0, 0, 5], target: [0, 0, 0], near: 0.01, far: 1000 }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    let resolvePivot: ((pivot: Vec3 | undefined) => void) | undefined;
    const pivotPromise = new Promise<Vec3 | undefined>((resolve) => {
      resolvePivot = resolve;
    });
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
      navigation: { pickPoint: () => pivotPromise, setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", pointer(100, 50));
    canvas.dispatch("pointermove", pointer(280, 50));
    expect(cameraRef.camera).toBe(initial);

    resolvePivot?.(undefined);
    await pivotPromise;
    await Promise.resolve();

    expect(getBounds).toHaveBeenCalledOnce();
    expect(cameraRef.camera.far).toBeLessThan(initial.far);
    expect(cameraRef.camera.near).toBeGreaterThan(0);
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

  it.each([
    ["Control", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
  ])("pans the scene right with %s+middle drag", (_modifier, modifiers) => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ position: [0, 0, 5], target: [0, 0, 0] }),
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

    expect(cameraRef.camera.position).toEqual([-0.3, 0, 5]);
    expect(cameraRef.camera.target).toEqual([-0.3, 0, 0]);
    expect(pickPoint).not.toHaveBeenCalled();
  });

  it("captures one target-plane anchor for Shift+middle drag", async () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ position: [0, 0, 5], target: [0, 0, 0] }),
      200,
      100,
    );
    const cameraRef = { camera: initial };
    let resolvePivot: ((pivot: Vec3 | undefined) => void) | undefined;
    const pivotPromise = new Promise<Vec3 | undefined>((resolve) => {
      resolvePivot = resolve;
    });
    installCameraControls({
      canvas: canvas as unknown as HTMLCanvasElement,
      cameraRef,
      navigation: { pickPoint: vi.fn(() => pivotPromise), setOrbitPivot: vi.fn() },
      onRender: vi.fn(),
    });

    canvas.dispatch("pointerdown", { ...pointer(100, 50), shiftKey: true });
    canvas.dispatch("pointermove", { ...pointer(100, 80), shiftKey: true });
    expect(cameraRef.camera).toBe(initial);

    const targetDepth = projectPoint(initial, initial.target)?.[2] ?? NaN;
    const anchor = unprojectPoint(initial, [90, 30, targetDepth]);
    resolvePivot?.(anchor);
    await pivotPromise;
    await Promise.resolve();

    expect(cameraRef.camera).not.toBe(initial);
    const projected = projectPoint(cameraRef.camera, anchor);
    expect(projected?.[0]).toBeCloseTo(90, 5);
    expect(projected?.[1]).toBeCloseTo(30, 5);
  });

  it("anchors pinch zoom at the current local midpoint after panning", () => {
    const canvas = new FakeCanvas();
    const initial = resizeCamera(
      createCamera({ position: [0, 0, 5], target: [0, 0, 0] }),
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
    const afterPan = panCamera(beforeFinalZoom, 15 / 100, -10 / 100);
    const midpoint = { x: 100, y: 50 };
    const targetDepth = projectPoint(afterPan, afterPan.target)?.[2] ?? NaN;
    const anchor = unprojectPoint(afterPan, [midpoint.x, midpoint.y, targetDepth]);
    canvas.dispatch("pointermove", touch(2, 180, 70));

    const projected = projectPoint(cameraRef.camera, anchor);
    expect(projected?.[0]).toBeCloseTo(midpoint.x, 5);
    expect(projected?.[1]).toBeCloseTo(midpoint.y, 5);
    expect(cameraRef.camera).not.toBe(initial);
  });

  it("uses bounds safety for Shift+middle zoom as well as the wheel", () => {
    const canvas = new FakeCanvas();
    const cameraRef = {
      camera: resizeCamera(
        createCamera({ position: [0, 0, 5], target: [0, 0, 0], near: 0.01, far: 8 }),
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
