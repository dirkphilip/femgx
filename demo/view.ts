import type { Camera, ElementRenderMode } from "../src/index";

/** Typed handles to the demo's DOM nodes. */
export interface DemoView {
  readonly canvas: HTMLCanvasElement;
  readonly axisGizmo: HTMLElement;
  readonly rendererStatus: HTMLElement;
  readonly modelSelect: HTMLSelectElement;
  readonly fitView: HTMLButtonElement;
  readonly projectionToggle: HTMLButtonElement;
  readonly projectionLabel: HTMLElement;
  readonly edgeOverlayToggle: HTMLButtonElement;
  readonly edgeOverlayLabel: HTMLElement;
  readonly depthTestToggle: HTMLButtonElement;
  readonly depthTestLabel: HTMLElement;
  readonly nodeOverlayToggle: HTMLButtonElement;
  readonly nodeOverlayLabel: HTMLElement;
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly visibilityPanel: HTMLElement;
  readonly inspectionPanel: HTMLElement;
  readonly statsPanel: HTMLElement;
  readonly performanceOverlay: HTMLElement;
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
  readonly mode: ElementRenderMode;
}

/** Locates the demo's DOM nodes, throwing when the page is misconfigured. */
export function queryDemoView(): DemoView {
  const canvas = document.querySelector<HTMLCanvasElement>("#view");
  const axisGizmo = document.querySelector<HTMLElement>("#axis-gizmo");
  const rendererStatus = document.querySelector<HTMLElement>("#renderer-status");
  const modelSelect = document.querySelector<HTMLSelectElement>("#model-select");
  const fitView = document.querySelector<HTMLButtonElement>("#fit-view");
  const projectionToggle = document.querySelector<HTMLButtonElement>("#projection-toggle");
  const projectionLabel = document.querySelector<HTMLElement>("#projection-label");
  const edgeOverlayToggle = document.querySelector<HTMLButtonElement>("#edge-overlay");
  const edgeOverlayLabel = document.querySelector<HTMLElement>("#edge-overlay-label");
  const depthTestToggle = document.querySelector<HTMLButtonElement>("#depth-test");
  const depthTestLabel = document.querySelector<HTMLElement>("#depth-test-label");
  const nodeOverlayToggle = document.querySelector<HTMLButtonElement>("#node-overlay");
  const nodeOverlayLabel = document.querySelector<HTMLElement>("#node-overlay-label");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset");
  const status = document.querySelector<HTMLElement>("#status");
  const visibilityPanel = document.querySelector<HTMLElement>("#visibility-panel");
  const inspectionPanel = document.querySelector<HTMLElement>("#inspection-panel");
  const statsPanel = document.querySelector<HTMLElement>("#stats-panel");
  const performanceOverlay = document.querySelector<HTMLElement>("#performance-overlay");
  const contextMenu = document.querySelector<HTMLElement>("#context-menu");
  if (
    canvas === null ||
    axisGizmo === null ||
    rendererStatus === null ||
    modelSelect === null ||
    fitView === null ||
    projectionToggle === null ||
    projectionLabel === null ||
    edgeOverlayToggle === null ||
    edgeOverlayLabel === null ||
    depthTestToggle === null ||
    depthTestLabel === null ||
    nodeOverlayToggle === null ||
    nodeOverlayLabel === null ||
    resetButton === null ||
    status === null ||
    visibilityPanel === null ||
    inspectionPanel === null ||
    statsPanel === null ||
    performanceOverlay === null ||
    contextMenu === null
  ) {
    throw new Error("missing demo controls");
  }
  return {
    canvas,
    axisGizmo,
    rendererStatus,
    modelSelect,
    fitView,
    projectionToggle,
    projectionLabel,
    edgeOverlayToggle,
    edgeOverlayLabel,
    depthTestToggle,
    depthTestLabel,
    nodeOverlayToggle,
    nodeOverlayLabel,
    resetButton,
    status,
    visibilityPanel,
    inspectionPanel,
    statsPanel,
    performanceOverlay,
    contextMenu,
  };
}

/** Reflects the camera and model summary in the status bar. */
export function updateStatus(view: DemoView, camera: Camera, info: StatusInfo): void {
  const cameraMode = camera.mode === "perspective" ? "perspective" : "orthographic";
  const hasRendererState = info.rendererState !== undefined && info.rendererState !== "";
  const renderer = hasRendererState ? `${info.renderer} · ${info.rendererState}` : info.renderer;
  view.rendererStatus.textContent = `Renderer ${renderer}`;
  view.projectionLabel.textContent = camera.mode === "perspective" ? "Perspective" : "Orthographic";
  view.projectionToggle.textContent =
    camera.mode === "perspective" ? "Orthographic" : "Perspective";
  view.status.textContent =
    `${info.model} · ${renderer} · ${info.visibleInstances} visible · ` +
    `${info.parts} parts · ${info.batches} batches · ${info.mode} · ${cameraMode} camera`;
}
