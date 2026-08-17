import { vi } from "vitest";
import {
  createCamera,
  installCameraControls,
  resizeCamera,
  type Vec3,
} from "../../../src/entries/camera";

interface PointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly defaultPrevented?: boolean;
}

interface WheelInput {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaY: number;
  readonly preventDefault: () => void;
}

/** DOM-like canvas fixture that captures camera-control listeners. */
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

/** Creates a touch camera-control fixture with navigation spies. */
function touchControlHarness() {
  const canvas = new FakeCanvas();
  const initial = resizeCamera(
    createCamera({ mode: "perspective", position: [0, 0, 5], target: [0, 0, 0] }),
    200,
    100,
  );
  const cameraRef = { camera: initial };
  const pickPoint = vi.fn(() => Promise.resolve([1, 0, 0] as Vec3));
  const marker = vi.fn<(pivot: Vec3 | undefined) => void>();
  const render = vi.fn();
  installCameraControls({
    canvas: canvas as unknown as HTMLCanvasElement,
    cameraRef,
    navigation: { pickPoint, setOrbitPivot: marker },
    onRender: render,
  });
  return { canvas, initial, cameraRef, pickPoint, marker, render };
}
/** Computes Euclidean distance for camera assertions. */
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export { FakeCanvas, pointer, touch, touchControlHarness, distance };
export type { PointerInput, WheelInput, Vec3 };
