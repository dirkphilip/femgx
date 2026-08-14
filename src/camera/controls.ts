import { panCamera, type Camera, zoomCamera } from "./camera";
import { clientToCanvasCss } from "./coordinates";
import { CameraGestureTracker, type GestureStep } from "./gestures";
import { boundsCenter, orbitCameraWithOptionalBounds, zoomCameraWithinBounds } from "./navigation";
import type { Bounds } from "../geometry/part";
import { length, subtract, type Vec3 } from "../math/vec3";

/**
 * Mutable camera holder replaced by the immutable camera operations.
 * @category Camera and math
 */
export interface CameraRef {
  camera: Camera;
}

/**
 * Renderer capabilities required by the opinionated camera interaction.
 * @category Camera and math
 */
export interface CameraNavigationTarget {
  pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined>;
  setOrbitPivot(pivot: Vec3 | undefined): void;
}

/**
 * Options for installing the library's pointer-driven camera behavior.
 * @category Camera and math
 */
export interface CameraControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly cameraRef: CameraRef;
  readonly navigation: CameraNavigationTarget;
  readonly bounds?: () => Bounds;
  readonly onRender: () => void;
  readonly onGestureChange?: (active: boolean) => void;
}

interface OrbitGesture {
  readonly fallbackPivot: Vec3;
  active: boolean;
  resolved: boolean;
  pivot: Vec3 | undefined;
}

const ORBIT_SCALE = 180;
const ZOOM_DRAG_SCALE = 300;

/**
 * Installs SpaceClaim-style mouse/touch navigation and returns its disposer.
 * Middle drag spins around the nearest visible point after it resolves, falling
 * back to the model-bounds center only when the pick misses or fails. The pivot
 * stays fixed for the gesture. Ctrl/Meta+middle pans, Shift+middle zooms, and
 * touch provides orbit/pan/pinch gestures.
 * @category Camera and math
 */
export function installCameraControls(options: CameraControlOptions): () => void {
  const controls = new CameraControls(options);
  return () => {
    controls.dispose();
  };
}

interface ProtectedCameraControlOptions extends CameraControlOptions {
  readonly protectedBounds: () => readonly Bounds[];
}

/** Installs viewport-owned controls with per-occurrence close-zoom protection. */
export function installCameraControlsWithProtectedBounds(
  options: ProtectedCameraControlOptions,
): () => void {
  const controls = new CameraControls(options, options.protectedBounds);
  return () => {
    controls.dispose();
  };
}

class CameraControls {
  private readonly abortController = new AbortController();
  private readonly tracker = new CameraGestureTracker();
  private readonly trackedPointerIds = new Set<number>();
  private readonly orbitGestures = new Map<number, OrbitGesture>();

  constructor(
    private readonly options: CameraControlOptions,
    private readonly protectedBounds?: () => readonly Bounds[],
  ) {
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
    const point = eventPoint(event, this.options.canvas.getBoundingClientRect());
    const step = this.tracker.begin(event.pointerId, point);
    if (event.pointerType !== "touch" && !event.shiftKey && !isPanModifier(event)) {
      this.beginOrbit(event);
    } else if (event.pointerType === "touch" && step.pointerCount === 1) {
      this.beginOrbit(event);
    } else if (event.pointerType === "touch") {
      this.orbitGestures.clear();
      this.options.navigation.setOrbitPivot(undefined);
    }
    if (step.pointerCount === 1) this.options.onGestureChange?.(true);
    if (!this.options.canvas.hasPointerCapture(event.pointerId)) {
      this.options.canvas.setPointerCapture(event.pointerId);
    }
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.trackedPointerIds.has(event.pointerId)) return;
    const point = eventPoint(event, this.options.canvas.getBoundingClientRect());
    if (this.applyGesture(event, this.tracker.move(event.pointerId, point))) {
      this.options.onRender();
    }
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
    this.options.onGestureChange?.(true);
    try {
      const amount = event.deltaY / 1000;
      const camera = this.options.cameraRef.camera;
      const next = this.zoom(amount, camera);
      if (next !== camera) {
        this.options.cameraRef.camera = next;
        this.options.onRender();
      }
    } finally {
      this.options.onGestureChange?.(false);
    }
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

  private applyGesture(event: PointerEvent, step: GestureStep): boolean {
    if (step.pointerCount >= 2) {
      return this.applyTouchGesture(step);
    }
    if (step.pointerCount !== 1 || (step.deltaX === 0 && step.deltaY === 0)) return false;
    const { cameraRef } = this.options;
    if (event.pointerType !== "touch" && isPanModifier(event)) {
      cameraRef.camera = panCameraByCssDelta(cameraRef.camera, step.deltaX, step.deltaY);
      return true;
    } else if (event.pointerType !== "touch" && event.shiftKey) {
      const before = cameraRef.camera;
      cameraRef.camera = this.zoom(step.deltaY / ZOOM_DRAG_SCALE);
      return cameraRef.camera !== before;
    } else {
      return this.applyOrbit(event.pointerId, step);
    }
  }

  private applyTouchGesture(step: GestureStep): boolean {
    const { cameraRef } = this.options;
    const beforePan = cameraRef.camera;
    if (step.deltaX !== 0 || step.deltaY !== 0) {
      cameraRef.camera = panCameraByCssDelta(cameraRef.camera, step.deltaX, step.deltaY);
    }
    if (step.zoom !== 0 && step.midpoint !== undefined) {
      cameraRef.camera = this.zoom(-step.zoom);
    }
    return cameraRef.camera !== beforePan;
  }

  private zoom(amount: number, camera = this.options.cameraRef.camera): Camera {
    const bounds = this.options.bounds?.();
    if (bounds === undefined) return zoomCamera(camera, amount);
    return zoomCameraWithinBounds(camera, amount, bounds, undefined, this.protectedBounds?.());
  }

  private applyOrbit(pointerId: number, step: GestureStep): boolean {
    const gesture = this.orbitGestures.get(pointerId);
    if (gesture !== undefined && !gesture.resolved) return false;
    const { cameraRef } = this.options;
    const before = cameraRef.camera;
    cameraRef.camera = orbitCameraWithOptionalBounds(
      cameraRef.camera,
      step.deltaX / ORBIT_SCALE,
      step.deltaY / ORBIT_SCALE,
      gesture === undefined ? undefined : (gesture.pivot ?? gesture.fallbackPivot),
      this.options.bounds?.(),
    );
    return cameraRef.camera !== before;
  }

  private beginOrbit(event: PointerEvent): void {
    const gesture: OrbitGesture = {
      fallbackPivot: this.fallbackTarget(this.options.cameraRef.camera),
      active: true,
      resolved: false,
      pivot: undefined,
    };
    this.orbitGestures.set(event.pointerId, gesture);
    const rect = this.options.canvas.getBoundingClientRect();
    const point = clientToCanvasCss(event.clientX, event.clientY, rect);
    let pivot: Promise<Vec3 | undefined>;
    try {
      pivot = this.options.navigation.pickPoint(this.options.cameraRef.camera, point.x, point.y);
    } catch {
      this.resolveOrbit(event.pointerId, gesture, undefined);
      return;
    }
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
    if (this.orbitGestures.get(pointerId) !== gesture || gesture.resolved) return;
    gesture.resolved = true;
    gesture.pivot = pivot;
    if (!gesture.active) {
      this.orbitGestures.delete(pointerId);
      return;
    }
    this.options.navigation.setOrbitPivot(pivot ?? gesture.fallbackPivot);
    this.options.onRender();
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

  private fallbackTarget(camera: Camera): Vec3 {
    const bounds = this.options.bounds?.();
    return bounds === undefined ? camera.target : boundsCenter(bounds);
  }
}

/** Translates view-plane content by a CSS-pixel gesture at the target depth. */
function panCameraByCssDelta(camera: Camera, deltaX: number, deltaY: number): Camera {
  if (deltaX === 0 && deltaY === 0) return camera;
  const worldUnitsPerPixel =
    camera.mode === "perspective"
      ? (2 * length(subtract(camera.position, camera.target)) * Math.tan(camera.fovY / 2)) /
        camera.height
      : camera.orthoHeight / camera.height;
  return panCamera(camera, deltaX * worldUnitsPerPixel, deltaY * worldUnitsPerPixel);
}

function eventPoint(
  event: { readonly clientX: number; readonly clientY: number },
  rect: Pick<DOMRect, "left" | "top">,
): {
  readonly x: number;
  readonly y: number;
} {
  return clientToCanvasCss(event.clientX, event.clientY, rect);
}

function isPanModifier(event: { readonly ctrlKey: boolean; readonly metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}
