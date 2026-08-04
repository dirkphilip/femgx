import { resizeCamera, setProjection, type Camera } from "../src/index";

/** Typed handles to the demo's DOM nodes. */
export interface DemoView {
  readonly canvas: HTMLCanvasElement;
  readonly projectionToggle: HTMLButtonElement;
  readonly projectionLabel: HTMLElement;
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
}

/** Mutable camera holder so controls can replace the camera immutably. */
export interface CameraRef {
  camera: Camera;
}

/** Shared inputs for the control-bar installers. */
export interface ControlContext {
  readonly view: DemoView;
  readonly cameraRef: CameraRef;
  readonly instanceCount: number;
  readonly partCount: number;
  readonly onRender: () => void;
}

/** Locates the demo's DOM nodes, throwing when the page is misconfigured. */
export function queryDemoView(): DemoView {
  const canvas = document.querySelector<HTMLCanvasElement>("#view");
  if (canvas === null) {
    throw new Error("missing #view canvas");
  }
  const projectionToggle = document.querySelector<HTMLButtonElement>("#projection-toggle");
  const projectionLabel = document.querySelector<HTMLElement>("#projection-label");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset");
  const status = document.querySelector<HTMLElement>("#status");
  if (
    projectionToggle === null ||
    projectionLabel === null ||
    resetButton === null ||
    status === null
  ) {
    throw new Error("missing demo controls");
  }
  return { canvas, projectionToggle, projectionLabel, resetButton, status };
}

/** Reflects the camera mode and model summary in the control bar. */
export function updateStatus(
  view: DemoView,
  camera: Camera,
  instanceCount: number,
  partCount: number,
): void {
  const mode = camera.mode === "perspective" ? "Perspective" : "Orthographic";
  view.projectionLabel.textContent = mode;
  view.projectionToggle.textContent =
    camera.mode === "perspective" ? "Orthographic" : "Perspective";
  view.status.textContent = `${instanceCount} instances · ${partCount} reusable parts · ${mode.toLowerCase()} camera`;
}

/** Wires the projection toggle to swap camera modes and re-render. */
export function installProjectionControl(context: ControlContext): void {
  const { view, cameraRef, onRender, instanceCount, partCount } = context;
  view.projectionToggle.addEventListener("click", () => {
    cameraRef.camera = setProjection(
      cameraRef.camera,
      cameraRef.camera.mode === "perspective" ? "orthographic" : "perspective",
    );
    updateStatus(view, cameraRef.camera, instanceCount, partCount);
    onRender();
  });
}

/** Wires the reset button to restore the initial camera and interaction state. */
export function installResetControl(
  context: ControlContext,
  initialCamera: Camera,
  resetInteraction: () => void,
): void {
  const { view, cameraRef, onRender, instanceCount, partCount } = context;
  view.resetButton.addEventListener("click", () => {
    cameraRef.camera = initialCamera;
    resetInteraction();
    updateStatus(view, cameraRef.camera, instanceCount, partCount);
    onRender();
  });
}

/** Wires window resizes to refit the camera, with an optional renderer hook. */
export function installResizeControl(
  view: DemoView,
  cameraRef: CameraRef,
  onRender: () => void,
  onResize?: () => void,
): void {
  window.addEventListener("resize", () => {
    const rect = view.canvas.getBoundingClientRect();
    cameraRef.camera = resizeCamera(cameraRef.camera, rect.width, rect.height);
    onResize?.();
    onRender();
  });
}
