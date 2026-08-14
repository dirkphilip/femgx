import type { DemoView } from "./view";
import type { WorkbenchPane } from "./view";
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
  readonly setBackground: (background: string) => void;
  readonly setEdges: () => void;
  readonly setNodes: () => void;
  readonly setContinuous: () => void;
  readonly setResultField: (value: string) => void;
  readonly setDeformationField: (value: string) => void;
  readonly setDeformationScale: (value: string) => void;
  readonly setVectorField: (value: string) => void;
  readonly setVectorGlyph: (value: string) => void;
  readonly setVectorTransform: (value: string) => void;
  readonly setVectorLengthScale: (value: string) => void;
  readonly setSectionAxis: (value: string) => void;
  readonly setSectionOffset: (value: string) => void;
  readonly setSelectionGranularity: (value: string) => void;
  readonly hideSelected: () => void;
  readonly showAll: () => void;
  readonly reset: () => void;
  readonly fitView: () => void;
  readonly setModel: (id: string) => void;
  readonly openModel: (file: File) => void;
  readonly setActive?: () => void;
  readonly toggleViewport?: () => void;
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
  installProjectionBinding(options);
  installDisplayBindings(options);
  installModelBindings(options);
  installWindowBindings(options);
}

function installProjectionBinding(options: WorkbenchBindingOptions): void {
  const { view, signal } = options;
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
      viewport.fitView();
    },
    { signal },
  );
}

function installDisplayBindings(options: WorkbenchBindingOptions): void {
  const { view, signal } = options;
  view.backgroundSelect.addEventListener(
    "change",
    () => {
      options.setBackground(view.backgroundSelect.value);
    },
    { signal },
  );
  view.edgeOverlayToggle.addEventListener("click", options.setEdges, { signal });
  view.resultField.addEventListener(
    "change",
    () => {
      options.setResultField(view.resultField.value);
    },
    { signal },
  );
  view.deformationField.addEventListener(
    "change",
    () => {
      options.setDeformationField(view.deformationField.value);
    },
    { signal },
  );
  view.deformationScale.addEventListener(
    "change",
    () => {
      options.setDeformationScale(view.deformationScale.value);
    },
    { signal },
  );
  installVectorBindings(options);
  installSectionBindings(options);
  view.nodeOverlayToggle.addEventListener("click", options.setNodes, { signal });
  view.continuousToggle.addEventListener("click", options.setContinuous, { signal });
  view.selectionGranularity.addEventListener(
    "change",
    () => {
      options.setSelectionGranularity(view.selectionGranularity.value);
    },
    { signal },
  );
  view.hideSelectedButton.addEventListener("click", options.hideSelected, { signal });
  view.showAllButton.addEventListener("click", options.showAll, { signal });
  view.resetButton.addEventListener("click", options.reset, { signal });
  view.fitView.addEventListener("click", options.fitView, { signal });
  if (options.toggleViewport !== undefined) {
    view.viewportToggle.addEventListener("click", options.toggleViewport, { signal });
  }
}

function installVectorBindings(options: WorkbenchBindingOptions): void {
  const { view, signal } = options;
  for (const [control, handler] of [
    [
      view.vectorField,
      () => {
        options.setVectorField(view.vectorField.value);
      },
    ],
    [
      view.vectorGlyph,
      () => {
        options.setVectorGlyph(view.vectorGlyph.value);
      },
    ],
    [
      view.vectorTransform,
      () => {
        options.setVectorTransform(view.vectorTransform.value);
      },
    ],
    [
      view.vectorLengthScale,
      () => {
        options.setVectorLengthScale(view.vectorLengthScale.value);
      },
    ],
  ] as const) {
    control.addEventListener("change", handler, { signal });
  }
}

function installSectionBindings(options: WorkbenchBindingOptions): void {
  const { view, signal } = options;
  view.sectionAxis.addEventListener(
    "change",
    () => {
      options.setSectionAxis(view.sectionAxis.value);
    },
    { signal },
  );
  view.sectionOffset.addEventListener(
    "input",
    () => {
      options.setSectionOffset(view.sectionOffset.value);
    },
    { signal },
  );
}

function installModelBindings(options: WorkbenchBindingOptions): void {
  const { view, signal } = options;
  view.modelSelect.addEventListener(
    "change",
    () => {
      options.setModel(view.modelSelect.value);
    },
    { signal },
  );
  view.openModelButton.addEventListener(
    "click",
    () => {
      view.modelFileInput.click();
    },
    { signal },
  );
  view.modelFileInput.addEventListener(
    "change",
    () => {
      const file = view.modelFileInput.files?.[0];
      if (file !== undefined) options.openModel(file);
    },
    { signal },
  );
}

function installWindowBindings(options: WorkbenchBindingOptions): void {
  const { view, signal } = options;
  window.addEventListener(
    "click",
    (event) => {
      if (view.contextMenu.hidden) return;
      if (event.target instanceof Node && view.contextMenu.contains(event.target)) return;
      options.interaction.clearContext();
    },
    { signal },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") options.interaction.clearContext();
    },
    { signal },
  );
}
