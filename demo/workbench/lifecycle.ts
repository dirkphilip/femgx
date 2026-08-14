import { installBoxSelection } from "../../src/index";
import type { DemoView, WorkbenchPane } from "./view";
import type { WorkbenchBoxPreview } from "./box-preview";
import type { WorkbenchInteraction } from "./interaction";
import { installWorkbenchBindings, installWorkbenchPaneBindings } from "./listeners";
import type { VisibilityPanelController } from "./visibility-panel";

export interface WorkbenchLifecycleOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly visibilityPanel: VisibilityPanelController;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly dragging: () => boolean;
  readonly setModel: (id: string) => void;
  readonly openModel: (file: File) => void;
  readonly setActive: () => void;
  readonly toggleViewport?: () => void;
}

/** Installs box selection and pane-local inspection for a secondary viewport. */
export function installWorkbenchPaneLifecycle(options: {
  readonly pane: WorkbenchPane;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly dragging: () => boolean;
  readonly setActive: () => void;
}): () => void {
  const boxSelectionDisposer = installBoxSelection({
    canvas: options.pane.canvas,
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
    onEvent: (event) => {
      options.boxPreview.handleEvent(event);
      if (event.type === "complete") void options.interaction.selectBox(event);
    },
  });
  options.visibilityPanel.install(options.signal);
  installWorkbenchBindings({
    view: options.view,
    canvas: options.canvas,
    signal: options.signal,
    interaction: options.interaction,
    dragging: options.dragging,
    setModel: options.setModel,
    openModel: options.openModel,
    setActive: options.setActive,
    ...(options.toggleViewport === undefined ? {} : { toggleViewport: options.toggleViewport }),
  });
  return boxSelectionDisposer;
}
