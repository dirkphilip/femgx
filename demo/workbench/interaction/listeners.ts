import type { WorkbenchPane } from "../viewport/view";
import type { WorkbenchInteraction } from "./interaction";

/** Pane-local deliberate activation and context-menu bindings. */
export interface WorkbenchPaneBindingOptions {
  readonly pane: WorkbenchPane;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  readonly setActive: () => void;
}

/** Installs the bindings that belong to one viewport pane. */
export function installWorkbenchPaneBindings(options: WorkbenchPaneBindingOptions): void {
  const { pane, signal, interaction } = options;
  const activate = (): void => {
    options.setActive();
    if (typeof pane.scene.focus === "function") pane.scene.focus({ preventScroll: true });
  };
  pane.scene.addEventListener("focusin", options.setActive, { signal });
  pane.canvas.addEventListener("pointerdown", activate, { signal });
  pane.canvas.addEventListener("contextmenu", (event) => void interaction.contextMenu(event), {
    signal,
  });
}
