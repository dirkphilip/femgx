import { installBoxSelection } from "../../src/index";
import type { WorkbenchPane } from "./viewport/view";
import type { WorkbenchBoxPreview } from "./selection/box-preview";
import type { WorkbenchInteraction } from "./interaction/interaction";
import { installWorkbenchPaneBindings } from "./interaction/listeners";
import type { TouchInteractionMode } from "./types";

interface WorkbenchPaneLifecycleOptions {
  readonly pane: WorkbenchPane;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly dragging: () => boolean;
  readonly touchInteractionMode: () => TouchInteractionMode;
  readonly setActive: () => void;
}

/** Installs box selection and pane-local inspection for one viewport. */
export function installWorkbenchPaneLifecycle(options: WorkbenchPaneLifecycleOptions): () => void {
  const boxSelectionDisposer = installBoxSelection({
    canvas: options.pane.canvas,
    touchEnabled: () => options.touchInteractionMode() === "box-select",
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
    touchInteractionMode: options.touchInteractionMode,
    setActive: options.setActive,
  });
  return boxSelectionDisposer;
}
