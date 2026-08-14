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
  readonly buildInfo: HTMLElement;
  readonly modelSelect: HTMLSelectElement;
  readonly modelSource: HTMLElement;
  readonly openModelButton: HTMLButtonElement;
  readonly modelFileInput: HTMLInputElement;
  readonly modelFeedback: HTMLElement;
  readonly fitView: HTMLButtonElement;
  readonly selectionGranularity: HTMLSelectElement;
  readonly hideSelectedButton: HTMLButtonElement;
  readonly showAllButton: HTMLButtonElement;
  readonly projectionToggle: HTMLButtonElement;
  readonly backgroundSelect: HTMLSelectElement;
  readonly edgeOverlayToggle: HTMLButtonElement;
  readonly continuousToggle: HTMLButtonElement;
  readonly resultControls: HTMLElement;
  readonly resultField: HTMLSelectElement;
  readonly deformationField: HTMLSelectElement;
  readonly deformationScale: HTMLInputElement;
  readonly resultLegend: HTMLElement;
  readonly sectionControls: HTMLElement;
  readonly sectionAxis: HTMLSelectElement;
  readonly sectionOffset: HTMLInputElement;
  readonly sectionOffsetValue: HTMLOutputElement;
  readonly nodeOverlayToggle: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly visibilityPanel: HTMLElement;
  readonly inspectionPanel: HTMLElement;
  readonly statsPanel: HTMLElement;
  readonly statsContent: HTMLElement;
  readonly contextMenu: HTMLElement;
  readonly interactionHelp: HTMLElement;
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
  const elements = {
    canvas: requiredCanvas("#view"),
    scene: requiredElement(".scene"),
    boxSelectionOverlay: requiredElement("#box-selection-overlay"),
    secondaryCanvas: requiredCanvas("#secondary-view"),
    secondaryScene: requiredElement("#secondary-scene"),
    secondaryBoxSelectionOverlay: requiredElement("#secondary-box-selection-overlay"),
    viewportWorkspace: requiredElement("#viewport-workspace"),
    viewportToggle: requiredButton("#viewport-toggle"),
    rendererStatus: requiredElement("#renderer-status"),
    buildInfo: requiredElement("#build-info"),
    modelSelect: requiredSelect("#model-select"),
    modelSource: requiredElement("#model-source"),
    openModelButton: requiredButton("#open-model"),
    modelFileInput: requiredInput("#model-file"),
    modelFeedback: requiredElement("#model-feedback"),
    fitView: requiredButton("#fit-view"),
    selectionGranularity: requiredSelect("#selection-granularity"),
    hideSelectedButton: requiredButton("#hide-selected"),
    showAllButton: requiredButton("#show-all"),
    projectionToggle: requiredButton("#projection-toggle"),
    backgroundSelect: requiredSelect("#background-select"),
    edgeOverlayToggle: requiredButton("#edge-overlay"),
    continuousToggle: requiredButton("#continuous-rendering"),
    resultControls: requiredElement("#result-controls"),
    resultField: requiredSelect("#result-field"),
    deformationField: requiredSelect("#deformation-field"),
    deformationScale: requiredInput("#deformation-scale"),
    resultLegend: requiredElement("#result-legend"),
    sectionControls: requiredElement("#section-controls"),
    sectionAxis: requiredSelect("#section-axis"),
    sectionOffset: requiredInput("#section-offset"),
    sectionOffsetValue: requiredOutput("#section-offset-value"),
    nodeOverlayToggle: requiredButton("#node-overlay"),
    resetButton: requiredButton("#reset"),
    status: requiredElement("#status"),
    visibilityPanel: requiredElement("#visibility-panel"),
    inspectionPanel: requiredElement("#inspection-panel"),
    statsPanel: requiredElement("#stats-panel"),
    statsContent: requiredElement("#diagnostics-content"),
    contextMenu: requiredElement("#context-menu"),
    interactionHelp: requiredElement("#interaction-help"),
  };
  return createDemoView(elements);
}

type DemoViewElements = Omit<DemoView, "primaryPane" | "secondaryPane"> & {
  readonly secondaryCanvas: HTMLCanvasElement;
  readonly secondaryScene: HTMLElement;
  readonly secondaryBoxSelectionOverlay: HTMLElement;
};

function createDemoView(elements: DemoViewElements): DemoView {
  return {
    primaryPane: pane("primary", elements.scene, elements.canvas, elements.boxSelectionOverlay),
    secondaryPane: pane(
      "secondary",
      elements.secondaryScene,
      elements.secondaryCanvas,
      elements.secondaryBoxSelectionOverlay,
    ),
    ...elements,
  };
}

function requiredElement(selector: string): HTMLElement {
  return required(selector) as HTMLElement;
}

function requiredCanvas(selector: string): HTMLCanvasElement {
  return required(selector) as HTMLCanvasElement;
}

function requiredButton(selector: string): HTMLButtonElement {
  return required(selector) as HTMLButtonElement;
}

function requiredSelect(selector: string): HTMLSelectElement {
  return required(selector) as HTMLSelectElement;
}

function requiredInput(selector: string): HTMLInputElement {
  return required(selector) as HTMLInputElement;
}

function requiredOutput(selector: string): HTMLOutputElement {
  return required(selector) as HTMLOutputElement;
}

function required(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error("missing demo controls");
  return element;
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
