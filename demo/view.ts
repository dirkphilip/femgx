import { resizeCamera, setProjection, type Camera, type ElementRenderMode } from "../src/index";

/** Typed handles to the demo's DOM nodes. */
export interface DemoView {
  readonly canvas: HTMLCanvasElement;
  readonly modelSelect: HTMLSelectElement;
  readonly fitView: HTMLButtonElement;
  readonly projectionToggle: HTMLButtonElement;
  readonly projectionLabel: HTMLElement;
  readonly edgeOverlayToggle: HTMLButtonElement;
  readonly edgeOverlayLabel: HTMLElement;
  readonly depthTestToggle: HTMLButtonElement;
  readonly depthTestLabel: HTMLElement;
  readonly modeButtons: readonly HTMLButtonElement[];
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly visibilityPanel: HTMLElement;
  readonly inspectionPanel: HTMLElement;
  readonly statsPanel: HTMLElement;
  readonly contextMenu: HTMLElement;
}

/** Mutable camera holder so controls can replace the camera immutably. */
export interface CameraRef {
  camera: Camera;
}

/** Shared inputs for the control-bar installers. */
export interface ControlContext {
  readonly view: DemoView;
  readonly cameraRef: CameraRef;
  readonly mode: () => ElementRenderMode;
  readonly onRender: () => void;
  /** Applies the edge overlay to the model (e.g. per-part style overrides). */
  readonly setEdgeOverlay?: (enabled: boolean) => void;
  /** Applies the edge depth-test flag to the underlying renderer. */
  readonly setEdgeDepthTest?: (enabled: boolean) => void;
}

/** The model/renderer summary written into the status bar. */
export interface StatusInfo {
  readonly model: string;
  readonly renderer: string;
  readonly visibleInstances: number;
  readonly parts: number;
  readonly batches: number;
  readonly mode: ElementRenderMode;
}

/** Locates the demo's DOM nodes, throwing when the page is misconfigured. */
export function queryDemoView(): DemoView {
  const canvas = document.querySelector<HTMLCanvasElement>("#view");
  const modelSelect = document.querySelector<HTMLSelectElement>("#model-select");
  const fitView = document.querySelector<HTMLButtonElement>("#fit-view");
  const projectionToggle = document.querySelector<HTMLButtonElement>("#projection-toggle");
  const projectionLabel = document.querySelector<HTMLElement>("#projection-label");
  const edgeOverlayToggle = document.querySelector<HTMLButtonElement>("#edge-overlay");
  const edgeOverlayLabel = document.querySelector<HTMLElement>("#edge-overlay-label");
  const depthTestToggle = document.querySelector<HTMLButtonElement>("#depth-test");
  const depthTestLabel = document.querySelector<HTMLElement>("#depth-test-label");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset");
  const status = document.querySelector<HTMLElement>("#status");
  const visibilityPanel = document.querySelector<HTMLElement>("#visibility-panel");
  const inspectionPanel = document.querySelector<HTMLElement>("#inspection-panel");
  const statsPanel = document.querySelector<HTMLElement>("#stats-panel");
  const contextMenu = document.querySelector<HTMLElement>("#context-menu");
  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"));
  if (
    canvas === null ||
    modelSelect === null ||
    fitView === null ||
    projectionToggle === null ||
    projectionLabel === null ||
    edgeOverlayToggle === null ||
    edgeOverlayLabel === null ||
    depthTestToggle === null ||
    depthTestLabel === null ||
    resetButton === null ||
    status === null ||
    visibilityPanel === null ||
    inspectionPanel === null ||
    statsPanel === null ||
    contextMenu === null ||
    modeButtons.length === 0
  ) {
    throw new Error("missing demo controls");
  }
  return {
    canvas,
    modelSelect,
    fitView,
    projectionToggle,
    projectionLabel,
    edgeOverlayToggle,
    edgeOverlayLabel,
    depthTestToggle,
    depthTestLabel,
    modeButtons,
    resetButton,
    status,
    visibilityPanel,
    inspectionPanel,
    statsPanel,
    contextMenu,
  };
}

/** Reflects the camera and model summary in the status bar. */
export function updateStatus(view: DemoView, camera: Camera, info: StatusInfo): void {
  const cameraMode = camera.mode === "perspective" ? "perspective" : "orthographic";
  view.projectionLabel.textContent = camera.mode === "perspective" ? "Perspective" : "Orthographic";
  view.projectionToggle.textContent =
    camera.mode === "perspective" ? "Orthographic" : "Perspective";
  view.status.textContent =
    `${info.model} · ${info.renderer} · ${info.visibleInstances} visible · ` +
    `${info.parts} parts · ${info.batches} batches · ${info.mode} · ${cameraMode} camera`;
}

/** Wires the projection toggle to swap camera modes and re-render. */
export function installProjectionControl(context: ControlContext): void {
  const { view, cameraRef, onRender } = context;
  view.projectionToggle.addEventListener("click", () => {
    cameraRef.camera = setProjection(
      cameraRef.camera,
      cameraRef.camera.mode === "perspective" ? "orthographic" : "perspective",
    );
    onRender();
  });
}

/** Wires the edge-overlay toggle to apply or clear the edge style overrides. */
export function installEdgeOverlayControl(context: ControlContext): void {
  const { view, onRender, setEdgeOverlay } = context;
  let enabled = false;
  const reflect = (): void => {
    view.edgeOverlayLabel.textContent = enabled ? "On" : "Off";
    view.edgeOverlayToggle.textContent = enabled ? "Hide edges" : "Overlay edges";
  };
  view.edgeOverlayToggle.addEventListener("click", () => {
    enabled = !enabled;
    reflect();
    setEdgeOverlay?.(enabled);
    onRender();
  });
  reflect();
}

/** Wires the edge depth-test toggle to switch the overlay depth compare. */
export function installDepthTestControl(context: ControlContext): void {
  const { view, onRender, setEdgeDepthTest } = context;
  let enabled = true;
  const reflect = (): void => {
    view.depthTestLabel.textContent = enabled ? "On" : "Off";
    view.depthTestToggle.textContent = enabled ? "Depth test off" : "Depth test on";
  };
  view.depthTestToggle.addEventListener("click", () => {
    enabled = !enabled;
    reflect();
    setEdgeDepthTest?.(enabled);
    onRender();
  });
  reflect();
}

/** Wires the element mode buttons to switch the renderer's visible family. */
export function installModeControl(
  context: ControlContext,
  applyMode: (mode: ElementRenderMode) => void,
): void {
  const { view, onRender } = context;
  for (const button of view.modeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset["mode"];
      if (mode === undefined || mode === context.mode()) return;
      applyMode(mode as ElementRenderMode);
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
