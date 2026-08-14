import type { DemoView } from "./view";
import type { WorkbenchPane } from "./view";
import type { WorkbenchInteraction } from "./interaction";

/** High-level bindings that keep controller policy out of DOM event plumbing. */
export interface WorkbenchBindingOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly interaction: WorkbenchInteraction;
  /** True while a camera or box pointer gesture suppresses asynchronous hover. */
  readonly dragging: () => boolean;
  readonly setActive?: () => void;
}

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
  const { pane, signal } = options;
  const activate = (): void => {
    options.setActive();
    if (typeof pane.scene.focus === "function") pane.scene.focus({ preventScroll: true });
  };
  pane.scene.addEventListener("pointerenter", options.setActive, { signal });
  pane.scene.addEventListener("focusin", options.setActive, { signal });
  pane.canvas.addEventListener("pointerdown", activate, { signal });
  pane.canvas.addEventListener(
    "pointerdown",
    (event) => {
      options.interaction.pointerDown(event);
    },
    { signal },
  );
  pane.canvas.addEventListener(
    "pointercancel",
    () => {
      options.interaction.pointerCancel();
    },
    { signal },
  );
  pane.canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!options.dragging()) void options.interaction.hover(event);
    },
    { signal },
  );
  pane.canvas.addEventListener("click", (event) => void options.interaction.click(event), {
    signal,
  });
  pane.canvas.addEventListener(
    "contextmenu",
    (event) => void options.interaction.contextMenu(event),
    { signal },
  );
}

/** Installs the complete controller lifetime of toolbar/canvas/window listeners. */
export function installWorkbenchBindings(options: WorkbenchBindingOptions): void {
  const { view, canvas, signal } = options;
  const scene = Reflect.get(view, "scene") as unknown as HTMLElement | undefined;
  installWorkbenchPaneBindings({
    pane: {
      id: "primary",
      scene: scene ?? canvas,
      canvas,
      boxSelectionOverlay: Reflect.get(view, "boxSelectionOverlay"),
    },
    signal,
    interaction: options.interaction,
    dragging: options.dragging,
    setActive: options.setActive ?? (() => {}),
  });
}
