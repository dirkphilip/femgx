import { orbitCamera, panCamera, zoomCamera } from "../src/index";
import type { CameraRef } from "./view";

/** Options for wiring pointer-driven camera controls to the view canvas. */
export interface CameraControlOptions {
  readonly canvas: HTMLCanvasElement;
  readonly cameraRef: CameraRef;
  /** Optional per-move hook, run after the drag is applied and before render. */
  readonly onMove?: (event: PointerEvent) => void;
  readonly onRender: () => void;
}

/**
 * Wires CAD-style orbit, pan, and scroll zoom to the canvas. Left drag orbits;
 * middle drag (or shift-left drag) pans. Each pointer move and wheel event
 * renders exactly once through `onRender`.
 */
export function installCameraControls(options: CameraControlOptions): void {
  const { canvas, cameraRef, onMove, onRender } = options;
  let pointer: { readonly x: number; readonly y: number } | undefined;

  canvas.addEventListener("pointerdown", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (pointer !== undefined) {
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      const shouldPan = event.shiftKey || (event.buttons & 4) !== 0;
      cameraRef.camera = shouldPan
        ? panCamera(cameraRef.camera, dx / 100, -dy / 100)
        : orbitCamera(cameraRef.camera, -dx / 180, -dy / 180);
      pointer = { x: event.clientX, y: event.clientY };
    }
    onMove?.(event);
    onRender();
  });

  canvas.addEventListener("pointerup", (event) => {
    pointer = undefined;
    canvas.releasePointerCapture(event.pointerId);
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
}
