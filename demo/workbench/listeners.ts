import type { DemoView } from "../view";
import { setProjection, type FemViewport } from "../../src/index";
import type { WorkbenchInteraction } from "./interaction";
import type { WorkbenchMenu } from "./menu";

/** High-level bindings that keep controller policy out of DOM event plumbing. */
export interface WorkbenchBindingOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly viewport: () => FemViewport;
  readonly interaction: WorkbenchInteraction;
  readonly menu: WorkbenchMenu;
  /** True while a camera or box pointer gesture suppresses asynchronous hover. */
  readonly dragging: () => boolean;
  readonly setEdges: () => void;
  readonly setNodes: () => void;
  readonly setResults: () => void;
  readonly reset: () => void;
  readonly fitView: () => void;
  readonly fitSelection: () => void;
  readonly setPreset: (id: string) => void;
}

/** Installs the complete controller lifetime of toolbar/canvas/window listeners. */
export function installWorkbenchBindings(options: WorkbenchBindingOptions): void {
  const { view, canvas, signal } = options;
  view.projectionToggle.addEventListener(
    "click",
    () => {
      const viewport = options.viewport();
      viewport.setCamera(
        setProjection(
          viewport.camera,
          viewport.camera.mode === "perspective" ? "orthographic" : "perspective",
        ),
      );
    },
    { signal },
  );
  view.edgeOverlayToggle.addEventListener("click", options.setEdges, { signal });
  view.resultsToggle.addEventListener("click", options.setResults, { signal });
  view.nodeOverlayToggle.addEventListener("click", options.setNodes, { signal });
  view.resetButton.addEventListener("click", options.reset, { signal });
  view.fitView.addEventListener("click", options.fitView, { signal });
  view.modelSelect.addEventListener(
    "change",
    () => {
      options.setPreset(view.modelSelect.value);
    },
    { signal },
  );
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      options.interaction.pointerDown(event);
    },
    { signal },
  );
  canvas.addEventListener(
    "pointercancel",
    () => {
      options.interaction.pointerCancel();
    },
    { signal },
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!options.dragging()) void options.interaction.hover(event);
    },
    { signal },
  );
  canvas.addEventListener("click", (event) => void options.interaction.click(event), { signal });
  canvas.addEventListener("contextmenu", (event) => void options.interaction.contextMenu(event), {
    signal,
  });
  window.addEventListener(
    "click",
    () => {
      options.menu.hide();
    },
    { signal },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") options.menu.hide();
      else if (event.key.toLowerCase() === "z" && !isEditableTarget(event.target)) {
        event.preventDefault();
        options.fitSelection();
      }
    },
    { signal },
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
