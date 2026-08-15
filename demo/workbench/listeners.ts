import type { WorkbenchPane } from "./view";
import type { WorkbenchInteraction } from "./interaction";

/** Pane-local pointer and asynchronous inspection bindings. */
export interface WorkbenchPaneBindingOptions {
  readonly pane: WorkbenchPane;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly dragging: () => boolean;
  readonly setActive: () => void;
}

/** Installs the bindings that belong to one viewport pane. */
export function installWorkbenchPaneBindings(options: WorkbenchPaneBindingOptions): void {
  const { pane, signal, interaction } = options;
  const activate = (): void => {
    options.setActive();
    if (typeof pane.scene.focus === "function") pane.scene.focus({ preventScroll: true });
  };
  pane.scene.addEventListener("pointerenter", options.setActive, { signal });
  pane.scene.addEventListener("focusin", options.setActive, { signal });
  pane.canvas.addEventListener("pointerdown", activate, { signal });
  pane.canvas.addEventListener("pointerdown", interaction.pointerDown.bind(interaction), {
    signal,
  });
  pane.canvas.addEventListener("pointercancel", interaction.pointerCancel.bind(interaction), {
    signal,
  });
  pane.canvas.addEventListener(
    "pointerleave",
    (event) => {
      if (event.pointerType !== "touch") interaction.clearHover(true);
    },
    { signal },
  );
  pane.canvas.addEventListener("pointerup", interaction.pointerUp.bind(interaction), { signal });
  pane.canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!options.dragging()) void interaction.hover(event);
    },
    { signal },
  );
  pane.canvas.addEventListener("click", (event) => void interaction.click(event), {
    signal,
  });
  pane.canvas.addEventListener("contextmenu", (event) => void interaction.contextMenu(event), {
    signal,
  });
}
