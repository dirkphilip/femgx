import { installBoxSelection } from "../../src/index";
import type { DemoView, WorkbenchPane } from "./view";
import type { WorkbenchBoxPreview } from "./box-preview";
import type { WorkbenchInteraction } from "./interaction";
import { installWorkbenchBindings, installWorkbenchPaneBindings } from "./listeners";

export interface WorkbenchLifecycleOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly dragging: () => boolean;
  readonly touchBoxSelection: () => boolean;
  readonly setActive: () => void;
}

/** Installs box selection and pane-local inspection for a secondary viewport. */
export function installWorkbenchPaneLifecycle(options: {
  readonly pane: WorkbenchPane;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly dragging: () => boolean;
  readonly touchBoxSelection: () => boolean;
  readonly setActive: () => void;
}): () => void {
  const boxSelectionDisposer = installBoxSelection({
    canvas: options.pane.canvas,
    touchEnabled: options.touchBoxSelection,
    onEvent: (event) => {
      options.boxPreview.handleEvent(event);
      if (event.type === "complete") void options.interaction.selectBox(event);
    },
  });
  installWorkbenchPaneBindings({
    pane: options.pane,
    signal: options.signal,
    interaction: options.interaction,
    dragging: options.dragging,
    setActive: options.setActive,
  });
  return boxSelectionDisposer;
}

/** Installs the complete workbench listener lifetime and returns its box disposer. */
export function installWorkbenchLifecycle(options: WorkbenchLifecycleOptions): () => void {
  const boxSelectionDisposer = installBoxSelection({
    canvas: options.canvas,
    touchEnabled: options.touchBoxSelection,
    onEvent: (event) => {
      options.boxPreview.handleEvent(event);
      if (event.type === "complete") void options.interaction.selectBox(event);
    },
  });
  installWorkbenchBindings({
    view: options.view,
    signal: options.signal,
    interaction: options.interaction,
    dragging: options.dragging,
    setActive: options.setActive,
  });
  return boxSelectionDisposer;
}
