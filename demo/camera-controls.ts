import { orbitCamera, panCamera, zoomCamera } from "../src/index";
import { CameraGestureTracker, type GestureStep } from "./camera-gestures";
import type { CameraRef } from "./view";

/** Options for wiring pointer-driven camera controls to the view canvas. */
export interface CameraControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly cameraRef: CameraRef;
  readonly onRender: () => void;
  /**
   * Called when a camera gesture starts (first pointer down) or fully ends
   * (every pointer lifted, cancelled, or captured elsewhere).
   */
  readonly onGestureChange?: (active: boolean) => void;
}

/** The screen-pixel scale of a pan in world units. */
const PAN_SCALE = 100;
/** The orbit degrees per screen pixel. */
const ORBIT_SCALE = 180;

/**
 * Wires CAD-style orbit, pan, and scroll zoom to the canvas using unified
 * pointer tracking. One pointer orbits (or pans with shift/middle); two
 * pointers pan together and pinch-zoom by their distance; any pointerup,
 * pointercancel, lost capture, or uncaptured pointerout clears the active
 * gesture so it can never be left stuck. Each gesture move and wheel event
 * renders exactly once through `onRender`.
 */
export function installCameraControls(options: CameraControlOptions): void {
  const { canvas, cameraRef, onRender, onGestureChange } = options;
  const tracker = new CameraGestureTracker();
  const point = (event: { readonly clientX: number; readonly clientY: number }) => ({
    x: event.clientX,
    y: event.clientY,
  });
  const notifyGestureEnd = (step: GestureStep): void => {
    if (step.pointerCount === 0) onGestureChange?.(false);
  };

  canvas.addEventListener("pointerdown", (event) => {
    const step = tracker.begin(event.pointerId, point(event));
    if (step.pointerCount === 1) onGestureChange?.(true);
    if (!canvas.hasPointerCapture(event.pointerId)) {
      canvas.setPointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    applyGesture(event, tracker.move(event.pointerId, point(event)));
    onRender();
  });

  canvas.addEventListener("pointerup", (event) => {
    const step = tracker.end(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    notifyGestureEnd(step);
  });

  canvas.addEventListener("pointercancel", (event) => {
    const step = tracker.end(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    notifyGestureEnd(step);
  });

  canvas.addEventListener("lostpointercapture", (event) => {
    notifyGestureEnd(tracker.end(event.pointerId));
  });

  canvas.addEventListener("pointerout", (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) {
      notifyGestureEnd(tracker.end(event.pointerId));
    }
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      cameraRef.camera = zoomCamera(cameraRef.camera, event.deltaY / 1000);
      onRender();
    },
    { passive: false },
  );

  function applyGesture(event: PointerEvent, step: GestureStep): void {
    if (step.pointerCount === 1) {
      if (step.deltaX === 0 && step.deltaY === 0) return;
      const shouldPan = event.shiftKey || (event.buttons & 4) !== 0;
      cameraRef.camera = shouldPan
        ? panCamera(cameraRef.camera, step.deltaX / PAN_SCALE, -step.deltaY / PAN_SCALE)
        : orbitCamera(cameraRef.camera, -step.deltaX / ORBIT_SCALE, -step.deltaY / ORBIT_SCALE);
      return;
    }
    if (step.pointerCount >= 2) {
      if (step.deltaX !== 0 || step.deltaY !== 0) {
        cameraRef.camera = panCamera(
          cameraRef.camera,
          step.deltaX / PAN_SCALE,
          -step.deltaY / PAN_SCALE,
        );
      }
      if (step.zoom !== 0) {
        cameraRef.camera = zoomCamera(cameraRef.camera, step.zoom);
      }
    }
  }
}
