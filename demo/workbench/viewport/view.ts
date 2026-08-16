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
  };
  return createDemoView(elements);
}

interface DemoViewElements {
  readonly canvas: HTMLCanvasElement;
  readonly scene: HTMLElement;
  readonly boxSelectionOverlay: HTMLElement;
  readonly secondaryCanvas: HTMLCanvasElement;
  readonly secondaryScene: HTMLElement;
  readonly secondaryBoxSelectionOverlay: HTMLElement;
}

function createDemoView(elements: DemoViewElements): DemoView {
  return {
    primaryPane: pane("primary", elements.scene, elements.canvas, elements.boxSelectionOverlay),
    secondaryPane: pane(
      "secondary",
      elements.secondaryScene,
      elements.secondaryCanvas,
      elements.secondaryBoxSelectionOverlay,
    ),
  };
}

function requiredElement(selector: string): HTMLElement {
  const element = required(selector);
  if (!(element instanceof HTMLElement)) throw new TypeError(`${selector} is not an HTML element`);
  return element;
}

function requiredCanvas(selector: string): HTMLCanvasElement {
  const element = required(selector);
  if (!(element instanceof HTMLCanvasElement)) throw new TypeError(`${selector} is not a canvas`);
  return element;
}

function required(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error("missing demo controls");
  return element;
}
