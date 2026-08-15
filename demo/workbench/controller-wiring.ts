import type { FemViewport, InteractionState, SceneRuntime } from "../../src/index";
import { installWorkbenchLifecycle } from "./lifecycle";
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
import type { SectionAxis } from "./section-controls";
import type { VectorDisplayState } from "./result-controls";
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
  readonly vectorDisplay: VectorDisplayState;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly touchInteractionMode: "navigate" | "box-select";
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly interaction: InteractionState;
  readonly activeViewport: () => FemViewport;
  readonly viewports: () => readonly FemViewport[];
  readonly activeSlot: () => WorkbenchViewportSlot;
  readonly runtime: SceneRuntime;
  readonly setInteraction: (value: InteractionState) => void;
  readonly canClearCanvasHover: (slotId: ViewportSlotId) => boolean;
  readonly markCanvasHover: (slotId: ViewportSlotId) => void;
  readonly clearCanvasHover: (slotId: ViewportSlotId) => void;
  readonly applyDisplayedInteraction: () => void;
  readonly render: () => void;
  readonly publishSnapshot: () => void;
  readonly setEdges: () => void;
  readonly setDiagnostics: () => void;
  readonly fitSelection: () => void;
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
  readonly setBackground: (value: string) => void;
  readonly setNodes: () => void;
  readonly setContinuous: () => void;
  readonly setSelectionGranularity: (value: string) => void;
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
    activeViewport: context.activeViewport.bind(context),
    viewports: context.viewports.bind(context),
    activeSlot: context.activeSlot.bind(context),
    runtime: () => context.runtime,
    toggles: () => context.toggles,
    resultMode: () => context.resultMode,
    vectorFieldId: () => context.vectorDisplay.fieldId,
    vectorGlyph: () => context.vectorDisplay.glyph,
    vectorTransform: () => context.vectorDisplay.transform,
    continuous: () => context.continuousEnabled,
    selectionGranularity: () => context.selectionGranularity,
    touchBoxSelection: () => context.touchInteractionMode === "box-select",
    sectionAxis: () => context.sectionAxis,
    sectionOffset: () => context.sectionOffset,
    interaction: () => context.interaction,
    setInteraction: context.setInteraction.bind(context),
    canClearCanvasHover: context.canClearCanvasHover.bind(context),
    markCanvasHover: context.markCanvasHover.bind(context),
    clearCanvasHover: context.clearCanvasHover.bind(context),
    applyDisplayedInteraction: context.applyDisplayedInteraction.bind(context),
    render: context.render.bind(context),
    publishSnapshot: context.publishSnapshot.bind(context),
    setEdges: () => {
      context.setEdges();
    },
    setDiagnostics: () => {
      context.setDiagnostics();
    },
    fitSelection: context.fitSelection.bind(context),
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
    interaction: context.interactionController,
    boxPreview: context.boxPreview,
    dragging: () => context.isPointerGestureActive(),
    touchBoxSelection: () => context.touchInteractionMode === "box-select",
    setActive: () => {
      context.setActiveSlot("primary");
    },
  });
}
