import { orbitCamera, panCamera, type Camera, zoomCamera, zoomCameraAtPoint } from "./camera";
import { clientToCanvasCss } from "./coordinates";
import { CameraGestureTracker, type GestureStep } from "./gestures";
import type { Vec3 } from "../math/vec3";

/** Mutable camera holder replaced by the immutable camera operations. */
export interface CameraRef {
  camera: Camera;
}

/** Renderer capabilities required by the opinionated camera interaction. */
export interface CameraNavigationTarget {
  pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined>;
  setOrbitPivot(pivot: Vec3 | undefined): void;
}

/** Options for installing the library's pointer-driven camera behavior. */
export interface CameraControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly cameraRef: CameraRef;
  readonly navigation: CameraNavigationTarget;
  readonly onRender: () => void;
  readonly onGestureChange?: (active: boolean) => void;
}

interface OrbitGesture {
  readonly fallbackPivot: Vec3;
  active: boolean;
  resolved: boolean;
  pivot: Vec3 | undefined;
  deltaX: number;
  deltaY: number;
}

const PAN_SCALE = 100;
const ORBIT_SCALE = 180;
const ZOOM_DRAG_SCALE = 300;

/**
 * Installs SpaceClaim-style mouse/touch navigation and returns its disposer.
 * Middle drag spins around the nearest visible point, Ctrl/Meta+middle pans,
 * Shift+middle zooms, and touch provides orbit/pan/pinch gestures.
 */
export function installCameraControls(options: CameraControlOptions): () => void {
  const controls = new CameraControls(options);
  return () => {
    controls.dispose();
  };
}

class CameraControls {
  private readonly abortController = new AbortController();
  private readonly tracker = new CameraGestureTracker();
  private readonly trackedPointerIds = new Set<number>();
  private readonly orbitGestures = new Map<number, OrbitGesture>();
  private wheelQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: CameraControlOptions) {
    const signal = { signal: this.abortController.signal };
    options.canvas.addEventListener("pointerdown", this.pointerDown, signal);
    options.canvas.addEventListener("pointermove", this.pointerMove, signal);
    options.canvas.addEventListener("pointerup", this.pointerUp, signal);
    options.canvas.addEventListener("pointercancel", this.pointerCancel, signal);
    options.canvas.addEventListener("lostpointercapture", this.lostPointerCapture, signal);
    options.canvas.addEventListener("pointerout", this.pointerOut, signal);
    options.canvas.addEventListener("wheel", this.wheel, {
      passive: false,
      signal: this.abortController.signal,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.abortController.abort();
    try {
      this.options.navigation.setOrbitPivot(undefined);
    } catch {
      // Teardown can follow device loss; the renderer is already unable to draw.
    }
    this.trackedPointerIds.clear();
    this.orbitGestures.clear();
    this.tracker.clear();
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" && event.button !== 1) return;
    this.trackedPointerIds.add(event.pointerId);
    const step = this.tracker.begin(event.pointerId, eventPoint(event));
    if (event.pointerType !== "touch" && !event.shiftKey && !isPanModifier(event)) {
      this.beginOrbit(event);
    } else if (event.pointerType === "touch") {
      this.orbitGestures.delete(event.pointerId);
      this.options.navigation.setOrbitPivot(undefined);
    }
    if (step.pointerCount === 1) this.options.onGestureChange?.(true);
    if (!this.options.canvas.hasPointerCapture(event.pointerId)) {
      this.options.canvas.setPointerCapture(event.pointerId);
    }
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.trackedPointerIds.has(event.pointerId)) return;
    this.applyGesture(event, this.tracker.move(event.pointerId, eventPoint(event)));
    this.options.onRender();
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    this.endPointer(event, true);
  };

  private readonly pointerCancel = (event: PointerEvent): void => {
    this.endPointer(event, true);
  };

  private readonly lostPointerCapture = (event: PointerEvent): void => {
    this.endPointer(event, false);
  };

  private readonly pointerOut = (event: PointerEvent): void => {
    if (this.options.canvas.hasPointerCapture(event.pointerId)) return;
    this.endPointer(event, false);
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.options.canvas.getBoundingClientRect();
    const point = clientToCanvasCss(event.clientX, event.clientY, rect);
    const amount = event.deltaY / 1000;
    this.wheelQueue = this.wheelQueue.then(async () => {
      if (this.abortController.signal.aborted) return;
      let pivot: Vec3 | undefined;
      try {
        pivot = await this.options.navigation.pickPoint(
          this.options.cameraRef.camera,
          point.x,
          point.y,
        );
      } catch {
        pivot = undefined;
      }
      if (this.disposed) return;
      this.options.cameraRef.camera =
        pivot === undefined
          ? zoomCamera(this.options.cameraRef.camera, amount)
          : zoomCameraAtPoint(this.options.cameraRef.camera, amount, pivot);
      this.options.onRender();
    });
  };

  private endPointer(event: PointerEvent, releaseCapture: boolean): void {
    if (!this.trackedPointerIds.delete(event.pointerId)) return;
    this.releaseOrbit(event.pointerId);
    const step = this.tracker.end(event.pointerId);
    if (releaseCapture && this.options.canvas.hasPointerCapture(event.pointerId)) {
      this.options.canvas.releasePointerCapture(event.pointerId);
    }
    if (step.pointerCount === 0) this.options.onGestureChange?.(false);
  }

  private applyGesture(event: PointerEvent, step: GestureStep): void {
    if (step.pointerCount >= 2) {
      this.applyTouchGesture(step);
      return;
    }
    if (step.pointerCount !== 1 || (step.deltaX === 0 && step.deltaY === 0)) return;
    const { cameraRef } = this.options;
    if (event.pointerType !== "touch" && isPanModifier(event)) {
      cameraRef.camera = panCamera(
        cameraRef.camera,
        step.deltaX / PAN_SCALE,
        -step.deltaY / PAN_SCALE,
      );
    } else if (event.pointerType !== "touch" && event.shiftKey) {
      cameraRef.camera = zoomCamera(cameraRef.camera, step.deltaY / ZOOM_DRAG_SCALE);
    } else {
      this.applyOrbit(event.pointerId, step);
    }
  }

  private applyTouchGesture(step: GestureStep): void {
    const { cameraRef } = this.options;
    if (step.deltaX !== 0 || step.deltaY !== 0) {
      cameraRef.camera = panCamera(
        cameraRef.camera,
        step.deltaX / PAN_SCALE,
        -step.deltaY / PAN_SCALE,
      );
    }
    if (step.zoom !== 0) cameraRef.camera = zoomCamera(cameraRef.camera, -step.zoom);
  }

  private applyOrbit(pointerId: number, step: GestureStep): void {
    const gesture = this.orbitGestures.get(pointerId);
    if (gesture !== undefined && !gesture.resolved) {
      gesture.deltaX += step.deltaX;
      gesture.deltaY += step.deltaY;
      return;
    }
    const { cameraRef } = this.options;
    cameraRef.camera = orbitCamera(
      cameraRef.camera,
      step.deltaX / ORBIT_SCALE,
      step.deltaY / ORBIT_SCALE,
      gesture?.pivot,
    );
  }

  private beginOrbit(event: PointerEvent): void {
    const gesture: OrbitGesture = {
      fallbackPivot: this.options.cameraRef.camera.target,
      active: true,
      resolved: false,
      pivot: undefined,
      deltaX: 0,
      deltaY: 0,
    };
    this.orbitGestures.set(event.pointerId, gesture);
    const rect = this.options.canvas.getBoundingClientRect();
    const point = clientToCanvasCss(event.clientX, event.clientY, rect);
    const pivot = this.options.navigation.pickPoint(
      this.options.cameraRef.camera,
      point.x,
      point.y,
    );
    void pivot.then(
      (result) => {
        this.resolveOrbit(event.pointerId, gesture, result);
      },
      () => {
        this.resolveOrbit(event.pointerId, gesture, undefined);
      },
    );
  }

  private resolveOrbit(pointerId: number, gesture: OrbitGesture, pivot: Vec3 | undefined): void {
    if (this.orbitGestures.get(pointerId) !== gesture) return;
    gesture.resolved = true;
    gesture.pivot = pivot;
    this.applyQueuedOrbit(gesture, pivot);
    this.options.navigation.setOrbitPivot(gesture.active ? pivot : undefined);
    this.options.onRender();
    if (!gesture.active) this.orbitGestures.delete(pointerId);
  }

  private applyQueuedOrbit(gesture: OrbitGesture, pivot: Vec3 | undefined): void {
    if (gesture.deltaX === 0 && gesture.deltaY === 0) return;
    const { cameraRef } = this.options;
    cameraRef.camera = orbitCamera(
      cameraRef.camera,
      gesture.deltaX / ORBIT_SCALE,
      gesture.deltaY / ORBIT_SCALE,
      pivot ?? gesture.fallbackPivot,
    );
    gesture.deltaX = 0;
    gesture.deltaY = 0;
  }

  private releaseOrbit(pointerId: number): void {
    const gesture = this.orbitGestures.get(pointerId);
    if (gesture === undefined) return;
    gesture.active = false;
    if (gesture.resolved) {
      this.options.navigation.setOrbitPivot(undefined);
      this.options.onRender();
      this.orbitGestures.delete(pointerId);
    }
  }
}

function eventPoint(event: { readonly clientX: number; readonly clientY: number }): {
  readonly x: number;
  readonly y: number;
} {
  return { x: event.clientX, y: event.clientY };
}

function isPanModifier(event: { readonly ctrlKey: boolean; readonly metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}
