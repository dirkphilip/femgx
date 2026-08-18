import { type Viewport } from "../../src/entries/root";
import { installViewportInteraction } from "../../src/entries/interaction";
import type { WorkbenchPane } from "./viewport/view";
import type { WorkbenchBoxPreview } from "./selection/box-preview";
import type { WorkbenchInteraction } from "./interaction/interaction";
import { installWorkbenchPaneBindings } from "./interaction/listeners";
import type { TouchInteractionMode } from "./types";
import type { SelectionGranularity } from "./selection/pick";

interface WorkbenchPaneLifecycleOptions {
  readonly pane: WorkbenchPane;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly viewport: () => Viewport;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly selectionGranularity: () => SelectionGranularity;
  readonly touchInteractionMode: () => TouchInteractionMode;
  readonly setActive: () => void;
}

/** Installs box selection and pane-local inspection for one viewport. */
export function installWorkbenchPaneLifecycle(options: WorkbenchPaneLifecycleOptions): () => void {
  const interactionDisposer = installViewportInteraction({
    viewport: options.viewport(),
    canvas: options.pane.canvas,
    granularity: options.selectionGranularity,
    touchMode: options.touchInteractionMode,
    ...options.interaction.viewportInteractionOptions(),
    onBoxEvent: (event) => {
      options.boxPreview.handleEvent(event);
    },
  });
  installWorkbenchPaneBindings({
    pane: options.pane,
    signal: options.signal,
    interaction: options.interaction,
    setActive: options.setActive,
  });
  return () => {
    interactionDisposer();
  };
}
