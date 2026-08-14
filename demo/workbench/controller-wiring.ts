import type { FemViewport, InteractionState, SceneRuntime } from "../../src/index";
import { installWorkbenchLifecycle, type WorkbenchLifecycleOptions } from "./lifecycle";
import type { WorkbenchFeatures } from "./features";
import type { WorkbenchInteraction } from "./interaction";
import type { WorkbenchBoxPreview } from "./box-preview";
import type { WorkbenchMenu } from "./menu";
import type { VisibilityPanelController } from "./visibility-panel";
import type { WorkbenchOptions } from "./types";
import type { DemoView, ViewportSlotId } from "./view";
import type { WorkbenchModel } from "./model";
import type { DisplayToggles, ResultDisplayMode } from "./types";
import type { SelectionGranularity } from "./pick";
import type { WorkbenchViewportSlot } from "./viewport-slots";
import type { VisibilityRowTarget } from "./tree-hover";
import {
  createWorkbenchInfrastructure,
  type WorkbenchInfrastructure,
} from "./controller-infrastructure";

export interface WorkbenchControllerWiringContext {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: FemViewport;
  readonly model: WorkbenchModel;
  readonly models: readonly WorkbenchModel[];
  readonly toggles: DisplayToggles;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly interaction: InteractionState;
  readonly activeViewport: () => FemViewport;
  readonly viewports: () => readonly FemViewport[];
  readonly activeSlot: () => WorkbenchViewportSlot;
  readonly runtime: SceneRuntime;
  readonly setInteraction: (value: InteractionState) => void;
  readonly applyDisplayedInteraction: () => void;
  readonly render: () => void;
  readonly setTreeHover: (target: VisibilityRowTarget | undefined) => void;
  readonly setEdges: () => void;
  readonly setDiagnostics: () => void;
  readonly fitView: () => void;
  readonly reset: () => void;
  readonly applySharedState: () => void;
  readonly rebuildVisibility: () => void;
  readonly feedback: (message: string) => void;
  readonly onActiveSlotChanged: () => void;
  readonly menu: WorkbenchMenu;
  readonly visibilityPanel: VisibilityPanelController;
  readonly visibilityActions: WorkbenchFeatures["visibilityActions"];
  readonly interactionController: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly listenerController: AbortController;
  readonly isPointerGestureActive: () => boolean;
  readonly setActiveSlot: (slotId: ViewportSlotId) => void;
  readonly toggleSecondaryViewport: () => void;
  readonly setBackground: (value: string) => void;
  readonly setNodes: () => void;
  readonly setContinuous: () => void;
  readonly setSelectionGranularity: (value: string) => void;
  readonly setResultField: (value: string) => void;
  readonly setDeformationField: (value: string) => void;
  readonly setDeformationScale: (value: string) => void;
  readonly setModel: (id: string) => void;
  readonly openModel: (file: File) => void;
}

/** Builds the feature graph around one controller state owner. */
export function createControllerInfrastructure(
  context: WorkbenchControllerWiringContext,
  options: WorkbenchOptions,
): WorkbenchInfrastructure {
  return createWorkbenchInfrastructure({
    view: context.view,
    canvas: context.canvas,
    rendererName: context.rendererName,
    viewport: context.viewport,
    createViewport: options.createViewport,
    model: () => context.model,
    activeViewport: () => context.activeViewport(),
    viewports: () => context.viewports(),
    activeSlot: () => context.activeSlot(),
    runtime: () => context.runtime,
    toggles: () => context.toggles,
    resultMode: () => context.resultMode,
    deformationScale: () => context.deformationScale,
    continuous: () => context.continuousEnabled,
    selectionGranularity: () => context.selectionGranularity,
    interaction: () => context.interaction,
    setInteraction: (value) => {
      context.setInteraction(value);
    },
    applyDisplayedInteraction: () => {
      context.applyDisplayedInteraction();
    },
    render: () => {
      context.render();
    },
    setTreeHover: (target) => {
      context.setTreeHover(target);
    },
    setEdges: () => {
      context.setEdges();
    },
    setDiagnostics: () => {
      context.setDiagnostics();
    },
    fitView: () => {
      context.fitView();
    },
    reset: () => {
      context.reset();
    },
    applySharedState: () => {
      context.applySharedState();
    },
    rebuildVisibility: () => {
      context.rebuildVisibility();
    },
    feedback: (message) => {
      context.feedback(message);
    },
    onActiveSlotChanged: () => {
      context.onActiveSlotChanged();
    },
  });
}

/** Installs all long-lived DOM bindings for the controller. */
export function installControllerLifecycle(context: WorkbenchControllerWiringContext): () => void {
  return installWorkbenchLifecycle({
    view: context.view,
    canvas: context.canvas,
    signal: context.listenerController.signal,
    viewport: () => context.activeViewport(),
    interaction: context.interactionController,
    menu: context.menu,
    visibilityPanel: context.visibilityPanel,
    boxPreview: context.boxPreview,
    dragging: () => context.isPointerGestureActive(),
    setActive: () => {
      context.setActiveSlot("primary");
    },
    toggleViewport: () => {
      context.toggleSecondaryViewport();
    },
    ...lifecycleDisplayBindings(context),
    ...lifecycleModelBindings(context),
  });
}

function lifecycleDisplayBindings(
  context: WorkbenchControllerWiringContext,
): Pick<
  WorkbenchLifecycleOptions,
  | "setBackground"
  | "setEdges"
  | "setNodes"
  | "setContinuous"
  | "setSelectionGranularity"
  | "hideSelected"
  | "showAll"
  | "setResultField"
  | "setDeformationField"
  | "setDeformationScale"
> {
  return {
    setBackground: (value) => {
      context.setBackground(value);
    },
    setEdges: () => {
      context.setEdges();
    },
    setNodes: () => {
      context.setNodes();
    },
    setContinuous: () => {
      context.setContinuous();
    },
    setSelectionGranularity: (value) => {
      context.setSelectionGranularity(value);
    },
    hideSelected: () => {
      context.visibilityActions.hideSelected();
    },
    showAll: () => {
      context.visibilityActions.showAll();
    },
    setResultField: (value) => {
      context.setResultField(value);
    },
    setDeformationField: (value) => {
      context.setDeformationField(value);
    },
    setDeformationScale: (value) => {
      context.setDeformationScale(value);
    },
  };
}

function lifecycleModelBindings(
  context: WorkbenchControllerWiringContext,
): Pick<WorkbenchLifecycleOptions, "reset" | "fitView" | "setModel" | "openModel"> {
  return {
    reset: () => {
      context.reset();
    },
    fitView: () => {
      context.fitView();
    },
    setModel: (id) => {
      context.setModel(id);
    },
    openModel: (file) => {
      context.openModel(file);
    },
  };
}
