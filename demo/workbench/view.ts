import type { Camera } from "../../src/index";

export type ViewportSlotId = "primary" | "secondary";

/** DOM ownership for one demo viewport pane. */
export interface WorkbenchPane {
  readonly id: ViewportSlotId;
  readonly scene: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly boxSelectionOverlay: HTMLElement;
}

function pane(
  id: WorkbenchPane["id"],
  scene: HTMLElement,
  canvas: HTMLCanvasElement,
  boxSelectionOverlay: HTMLElement,
): WorkbenchPane {
  return { id, scene, canvas, boxSelectionOverlay };
}

/** Typed handles to the demo's DOM nodes. */
export interface DemoView {
  readonly primaryPane: WorkbenchPane;
  readonly secondaryPane: WorkbenchPane;
  readonly viewportWorkspace: HTMLElement;
  readonly viewportToggle: HTMLButtonElement;
  readonly canvas: HTMLCanvasElement;
  readonly scene: HTMLElement;
  readonly boxSelectionOverlay: HTMLElement;
  readonly rendererStatus: HTMLElement;
  readonly modelSelect: HTMLSelectElement;
  readonly modelSource: HTMLElement;
  readonly openGlbButton: HTMLButtonElement;
  readonly glbFileInput: HTMLInputElement;
  readonly modelFeedback: HTMLElement;
  readonly fitView: HTMLButtonElement;
  readonly elementSelectionToggle: HTMLButtonElement;
  readonly projectionToggle: HTMLButtonElement;
  readonly backgroundSelect: HTMLSelectElement;
  readonly edgeOverlayToggle: HTMLButtonElement;
  readonly continuousToggle: HTMLButtonElement;
  readonly resultsToggle: HTMLButtonElement;
  readonly nodeOverlayToggle: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly visibilityPanel: HTMLElement;
  readonly inspectionPanel: HTMLElement;
  readonly statsPanel: HTMLElement;
  readonly statsContent: HTMLElement;
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
  const secondaryCanvas = document.querySelector<HTMLCanvasElement>("#secondary-view");
  const secondaryScene = document.querySelector<HTMLElement>("#secondary-scene");
  const secondaryBoxSelectionOverlay = document.querySelector<HTMLElement>(
    "#secondary-box-selection-overlay",
  );
  const viewportWorkspace = document.querySelector<HTMLElement>("#viewport-workspace");
  const viewportToggle = document.querySelector<HTMLButtonElement>("#viewport-toggle");
  const rendererStatus = document.querySelector<HTMLElement>("#renderer-status");
  const modelSelect = document.querySelector<HTMLSelectElement>("#model-select");
  const modelSource = document.querySelector<HTMLElement>("#model-source");
  const openGlbButton = document.querySelector<HTMLButtonElement>("#open-glb");
  const glbFileInput = document.querySelector<HTMLInputElement>("#glb-file");
  const modelFeedback = document.querySelector<HTMLElement>("#model-feedback");
  const fitView = document.querySelector<HTMLButtonElement>("#fit-view");
  const elementSelectionToggle = document.querySelector<HTMLButtonElement>("#element-select");
  const projectionToggle = document.querySelector<HTMLButtonElement>("#projection-toggle");
  const backgroundSelect = document.querySelector<HTMLSelectElement>("#background-select");
  const edgeOverlayToggle = document.querySelector<HTMLButtonElement>("#edge-overlay");
  const continuousToggle = document.querySelector<HTMLButtonElement>("#continuous-rendering");
  const resultsToggle = document.querySelector<HTMLButtonElement>("#results-toggle");
  const nodeOverlayToggle = document.querySelector<HTMLButtonElement>("#node-overlay");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset");
  const status = document.querySelector<HTMLElement>("#status");
  const visibilityPanel = document.querySelector<HTMLElement>("#visibility-panel");
  const inspectionPanel = document.querySelector<HTMLElement>("#inspection-panel");
  const statsPanel = document.querySelector<HTMLElement>("#stats-panel");
  const statsContent = document.querySelector<HTMLElement>("#diagnostics-content");
  const contextMenu = document.querySelector<HTMLElement>("#context-menu");
  if (
    canvas === null ||
    scene === null ||
    boxSelectionOverlay === null ||
    secondaryCanvas === null ||
    secondaryScene === null ||
    secondaryBoxSelectionOverlay === null ||
    viewportWorkspace === null ||
    viewportToggle === null ||
    rendererStatus === null ||
    modelSelect === null ||
    modelSource === null ||
    openGlbButton === null ||
    glbFileInput === null ||
    modelFeedback === null ||
    fitView === null ||
    elementSelectionToggle === null ||
    projectionToggle === null ||
    backgroundSelect === null ||
    edgeOverlayToggle === null ||
    continuousToggle === null ||
    resultsToggle === null ||
    nodeOverlayToggle === null ||
    resetButton === null ||
    status === null ||
    visibilityPanel === null ||
    inspectionPanel === null ||
    statsPanel === null ||
    statsContent === null ||
    contextMenu === null
  ) {
    throw new Error("missing demo controls");
  }
  return {
    primaryPane: pane("primary", scene, canvas, boxSelectionOverlay),
    secondaryPane: pane("secondary", secondaryScene, secondaryCanvas, secondaryBoxSelectionOverlay),
    viewportWorkspace,
    viewportToggle,
    canvas,
    scene,
    boxSelectionOverlay,
    rendererStatus,
    modelSelect,
    modelSource,
    openGlbButton,
    glbFileInput,
    modelFeedback,
    fitView,
    elementSelectionToggle,
    projectionToggle,
    backgroundSelect,
    edgeOverlayToggle,
    continuousToggle,
    resultsToggle,
    nodeOverlayToggle,
    resetButton,
    status,
    visibilityPanel,
    inspectionPanel,
    statsPanel,
    statsContent,
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
