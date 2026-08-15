import { installBoxSelection } from "../../src/index";
import type { WorkbenchPane } from "./view";
import type { WorkbenchBoxPreview } from "./box-preview";
import type { WorkbenchInteraction } from "./interaction";
import { installWorkbenchPaneBindings } from "./listeners";

interface WorkbenchPaneLifecycleOptions {
  readonly pane: WorkbenchPane;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly dragging: () => boolean;
  readonly touchBoxSelection: () => boolean;
  readonly setActive: () => void;
}

/** Installs box selection and pane-local inspection for one viewport. */
export function installWorkbenchPaneLifecycle(options: WorkbenchPaneLifecycleOptions): () => void {
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
