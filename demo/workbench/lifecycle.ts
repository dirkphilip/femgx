import { installBoxSelection } from "../../src/index";
import type { FemViewport } from "../../src/index";
import type { DemoView } from "./view";
import type { WorkbenchBoxPreview } from "./box-preview";
import type { WorkbenchInteraction } from "./interaction";
import { installWorkbenchBindings } from "./listeners";
import type { WorkbenchMenu } from "./menu";
import type { VisibilityPanelController } from "./visibility-panel";

export interface WorkbenchLifecycleOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly viewport: () => FemViewport;
  readonly interaction: WorkbenchInteraction;
  readonly menu: WorkbenchMenu;
  readonly visibilityPanel: VisibilityPanelController;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly dragging: () => boolean;
  readonly setEdges: () => void;
  readonly setNodes: () => void;
  readonly setResults: () => void;
  readonly reset: () => void;
  readonly fitView: () => void;
  readonly fitSelection: () => void;
  readonly setModel: (id: string) => void;
  readonly openGlb: (file: File) => void;
}

/** Installs the complete workbench listener lifetime and returns its box disposer. */
export function installWorkbenchLifecycle(options: WorkbenchLifecycleOptions): () => void {
  const boxSelectionDisposer = installBoxSelection({
    canvas: options.canvas,
    onEvent: (event) => {
      options.boxPreview.handleEvent(event);
    },
  });
  options.visibilityPanel.install(options.signal);
  options.menu.install(options.signal);
  installWorkbenchBindings({
    view: options.view,
    canvas: options.canvas,
    signal: options.signal,
    viewport: options.viewport,
    interaction: options.interaction,
    menu: options.menu,
    dragging: options.dragging,
    setEdges: options.setEdges,
    setNodes: options.setNodes,
    setResults: options.setResults,
    reset: options.reset,
    fitView: options.fitView,
    fitSelection: options.fitSelection,
    setModel: options.setModel,
    openGlb: options.openGlb,
  });
  return boxSelectionDisposer;
}
