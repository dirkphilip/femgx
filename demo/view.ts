import type { Camera } from "../src/index";

/** Typed handles to the demo's DOM nodes. */
export interface DemoView {
  readonly canvas: HTMLCanvasElement;
  readonly scene: HTMLElement;
  readonly boxSelectionOverlay: HTMLElement;
  readonly rendererStatus: HTMLElement;
  readonly modelSelect: HTMLSelectElement;
  readonly fitView: HTMLButtonElement;
  readonly projectionToggle: HTMLButtonElement;
  readonly edgeOverlayToggle: HTMLButtonElement;
  readonly resultsToggle: HTMLButtonElement;
  readonly nodeOverlayToggle: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly visibilityPanel: HTMLElement;
  readonly inspectionPanel: HTMLElement;
  readonly statsPanel: HTMLElement;
  readonly contextMenu: HTMLElement;
}

/** The model/renderer summary written into the status bar. */
export interface StatusInfo {
  readonly model: string;
  readonly renderer: string;
  /** Optional renderer-state note (e.g. "recovered"). */
  readonly rendererState?: string;
  readonly visibleInstances: number;
  readonly parts: number;
  readonly batches: number;
}

/** Locates the demo's DOM nodes, throwing when the page is misconfigured. */
export function queryDemoView(): DemoView {
  const canvas = document.querySelector<HTMLCanvasElement>("#view");
  const scene = document.querySelector<HTMLElement>(".scene");
  const boxSelectionOverlay = document.querySelector<HTMLElement>("#box-selection-overlay");
  const rendererStatus = document.querySelector<HTMLElement>("#renderer-status");
  const modelSelect = document.querySelector<HTMLSelectElement>("#model-select");
  const fitView = document.querySelector<HTMLButtonElement>("#fit-view");
  const projectionToggle = document.querySelector<HTMLButtonElement>("#projection-toggle");
  const edgeOverlayToggle = document.querySelector<HTMLButtonElement>("#edge-overlay");
  const resultsToggle = document.querySelector<HTMLButtonElement>("#results-toggle");
  const nodeOverlayToggle = document.querySelector<HTMLButtonElement>("#node-overlay");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset");
  const status = document.querySelector<HTMLElement>("#status");
  const visibilityPanel = document.querySelector<HTMLElement>("#visibility-panel");
  const inspectionPanel = document.querySelector<HTMLElement>("#inspection-panel");
  const statsPanel = document.querySelector<HTMLElement>("#stats-panel");
  const contextMenu = document.querySelector<HTMLElement>("#context-menu");
  if (
    canvas === null ||
    scene === null ||
    boxSelectionOverlay === null ||
    rendererStatus === null ||
    modelSelect === null ||
    fitView === null ||
    projectionToggle === null ||
    edgeOverlayToggle === null ||
    resultsToggle === null ||
    nodeOverlayToggle === null ||
    resetButton === null ||
    status === null ||
    visibilityPanel === null ||
    inspectionPanel === null ||
    statsPanel === null ||
    contextMenu === null
  ) {
    throw new Error("missing demo controls");
  }
  return {
    canvas,
    scene,
    boxSelectionOverlay,
    rendererStatus,
    modelSelect,
    fitView,
    projectionToggle,
    edgeOverlayToggle,
    resultsToggle,
    nodeOverlayToggle,
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
  const hasRendererState = info.rendererState !== undefined && info.rendererState !== "";
  const renderer = hasRendererState ? `${info.renderer} · ${info.rendererState}` : info.renderer;
  view.rendererStatus.textContent = `Renderer ${renderer}`;
  view.status.textContent =
    `${info.model} · ${renderer} · ${info.visibleInstances} visible · ` +
    `${info.parts} parts · ${info.batches} batches · ${cameraMode} camera`;
  view.projectionToggle.textContent = cameraMode === "perspective" ? "Perspective" : "Orthographic";
  view.projectionToggle.setAttribute("aria-label", `Projection: ${cameraMode}`);
}
