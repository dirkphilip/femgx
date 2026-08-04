import { resizeCamera, setProjection, type Camera, type ElementRenderMode } from "../src/index";

/** Typed handles to the demo's DOM nodes. */
export interface DemoView {
  readonly canvas: HTMLCanvasElement;
  readonly projectionToggle: HTMLButtonElement;
  readonly projectionLabel: HTMLElement;
  readonly displayModeToggle: HTMLButtonElement;
  readonly displayModeLabel: HTMLElement;
  readonly modeButtons: readonly HTMLButtonElement[];
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
}

/** How the renderer draws the visible color pass. */
export type DisplayMode = "solid" | "edge";

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
  readonly mode: () => ElementRenderMode;
  readonly onRender: () => void;
  /** Applies the display mode to the underlying renderer. */
  readonly setDisplayMode?: (mode: DisplayMode) => void;
}

/** Locates the demo's DOM nodes, throwing when the page is misconfigured. */
export function queryDemoView(): DemoView {
  const canvas = document.querySelector<HTMLCanvasElement>("#view");
  if (canvas === null) {
    throw new Error("missing #view canvas");
  }
  const projectionToggle = document.querySelector<HTMLButtonElement>("#projection-toggle");
  const projectionLabel = document.querySelector<HTMLElement>("#projection-label");
  const displayModeToggle = document.querySelector<HTMLButtonElement>("#display-mode");
  const displayModeLabel = document.querySelector<HTMLElement>("#display-mode-label");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset");
  const status = document.querySelector<HTMLElement>("#status");
  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"));
  if (
    projectionToggle === null ||
    projectionLabel === null ||
    displayModeToggle === null ||
    displayModeLabel === null ||
    resetButton === null ||
    status === null ||
    modeButtons.length === 0
  ) {
    throw new Error("missing demo controls");
  }
  return {
    canvas,
    projectionToggle,
    projectionLabel,
    displayModeToggle,
    displayModeLabel,
    modeButtons,
    resetButton,
    status,
  };
}

/** Reflects the camera mode, element mode, and model summary in the control bar. */
export function updateStatus(view: DemoView, camera: Camera, context: ControlContext): void {
  const cameraMode = camera.mode === "perspective" ? "Perspective" : "Orthographic";
  view.projectionLabel.textContent = cameraMode;
  view.projectionToggle.textContent =
    camera.mode === "perspective" ? "Orthographic" : "Perspective";
  view.status.textContent = `${context.instanceCount} instances · ${context.partCount} reusable parts · ${context.mode()} · ${cameraMode.toLowerCase()} camera`;
}

/** Wires the projection toggle to swap camera modes and re-render. */
export function installProjectionControl(context: ControlContext): void {
  const { view, cameraRef, onRender } = context;
  view.projectionToggle.addEventListener("click", () => {
    cameraRef.camera = setProjection(
      cameraRef.camera,
      cameraRef.camera.mode === "perspective" ? "orthographic" : "perspective",
    );
    updateStatus(view, cameraRef.camera, context);
    onRender();
  });
}

/** Wires the display-mode toggle to switch between solid and edge rendering. */
export function installDisplayModeControl(context: ControlContext): void {
  const { view, onRender, setDisplayMode } = context;
  let mode: DisplayMode = "solid";
  view.displayModeToggle.addEventListener("click", () => {
    mode = mode === "solid" ? "edge" : "solid";
    view.displayModeLabel.textContent = mode === "solid" ? "Solid" : "Edges";
    view.displayModeToggle.textContent = mode === "solid" ? "Edges" : "Solid";
    setDisplayMode?.(mode);
    onRender();
  });
}

/** Wires the element mode buttons to switch the renderer's visible family. */
export function installModeControl(
  context: ControlContext,
  applyMode: (mode: ElementRenderMode) => void,
): void {
  const { view, cameraRef, onRender } = context;
  for (const button of view.modeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset["mode"];
      if (mode === undefined || mode === context.mode()) return;
      applyMode(mode as ElementRenderMode);
      updateStatus(view, cameraRef.camera, context);
      onRender();
    });
  }
}

/** Wires the reset button to restore the initial camera and interaction state. */
export function installResetControl(
  context: ControlContext,
  initialCamera: Camera,
  resetInteraction: () => void,
): void {
  const { view, cameraRef, onRender } = context;
  view.resetButton.addEventListener("click", () => {
    cameraRef.camera = initialCamera;
    resetInteraction();
    updateStatus(view, cameraRef.camera, context);
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
