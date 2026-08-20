import type { Viewport } from "../../../src/entries/root";
import type { InteractionState } from "../../../src/entries/interaction";
import type { SceneOccurrences } from "../../../src/entries/root";
import { installWorkbenchPaneLifecycle } from "../lifecycle";
import type { WorkbenchFeatures } from "../state/features";
import type { WorkbenchInteraction } from "../interaction/interaction";
import type { WorkbenchBoxPreview } from "../selection/box-preview";
import type { WorkbenchMenu } from "../interaction/menu";
import type { VisibilityPanelController } from "../state/visibility-panel";
import type { TouchInteractionMode, WorkbenchOptions } from "../types";
import type { DemoView, ViewportSlotId } from "../viewport/view";
import type { WorkbenchModel } from "../models/model";
import type { DisplayToggles, ResultDisplayMode } from "../types";
import type { SelectionGranularity } from "../selection/pick";
import type { WorkbenchViewportSlot } from "../viewport/viewport-slots";
import type { SectionAxis } from "../section-controls";
import type { VectorDisplayState } from "../results/result-controls";
import type { BoxSelectionStrategy } from "../selection/box-selection-resolver";
import {
  createWorkbenchInfrastructure,
  type WorkbenchInfrastructure,
} from "./controller-infrastructure";

export interface WorkbenchControllerWiringContext {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: Viewport;
  readonly model: WorkbenchModel;
  readonly models: readonly WorkbenchModel[];
  readonly toggles: DisplayToggles;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly selectionGranularityForSlot: (slotId: ViewportSlotId) => SelectionGranularity;
  readonly touchInteractionMode: TouchInteractionMode;
  readonly touchInteractionModeForSlot: (slotId: ViewportSlotId) => TouchInteractionMode;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly interaction: InteractionState;
  readonly getInspection: () => { readonly visible: boolean; readonly text: string };
  readonly setInspection: (value: { readonly visible: boolean; readonly text: string }) => void;
  readonly setInspectionForSlot: (
    slotId: ViewportSlotId,
    value: { readonly visible: boolean; readonly text: string },
  ) => void;
  readonly activeViewport: () => Viewport;
  readonly viewports: () => readonly Viewport[];
  readonly activeSlot: () => WorkbenchViewportSlot;
  readonly runtime: SceneOccurrences;
  readonly setInteraction: (value: InteractionState) => void;
  readonly interactionForSlot: (slotId: ViewportSlotId) => InteractionState;
  readonly setInteractionForSlot: (slotId: ViewportSlotId, value: InteractionState) => void;
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
  readonly applyActiveState: () => void;
  readonly applyState: (slotId: ViewportSlotId) => void;
  readonly cloneShowState: (from: ViewportSlotId, to: ViewportSlotId) => void;
  readonly removeShowState: (slotId: ViewportSlotId) => void;
  readonly rebuildVisibility: () => void;
  readonly feedback: (message: string) => void;
  readonly onActiveSlotChanged: (slotId: ViewportSlotId) => void;
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
    primaryViewport: () => context.viewport,
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
    boxSelectionStrategy: () => context.boxSelectionStrategy,
    selectionGranularityForSlot: context.selectionGranularityForSlot.bind(context),
    touchInteractionMode: () => context.touchInteractionMode,
    touchInteractionModeForSlot: context.touchInteractionModeForSlot.bind(context),
    sectionAxis: () => context.sectionAxis,
    sectionOffset: () => context.sectionOffset,
    interaction: () => context.interaction,
    setInteraction: context.setInteraction.bind(context),
    getInspection: context.getInspection.bind(context),
    setInspection: context.setInspection.bind(context),
    setInspectionForSlot: context.setInspectionForSlot.bind(context),
    interactionForSlot: context.interactionForSlot.bind(context),
    setInteractionForSlot: context.setInteractionForSlot.bind(context),
    canClearCanvasHover: context.canClearCanvasHover.bind(context),
    markCanvasHover: context.markCanvasHover.bind(context),
    clearCanvasHover: context.clearCanvasHover.bind(context),
    applyDisplayedInteraction: context.applyDisplayedInteraction.bind(context),
    render: context.render.bind(context),
    publishSnapshot: context.publishSnapshot.bind(context),
    setEdges: context.setEdges.bind(context),
    setDiagnostics: context.setDiagnostics.bind(context),
    fitSelection: context.fitSelection.bind(context),
    reset: context.reset.bind(context),
    applyActiveState: context.applyActiveState.bind(context),
    applyState: context.applyState.bind(context),
    cloneShowState: context.cloneShowState.bind(context),
    removeShowState: context.removeShowState.bind(context),
    rebuildVisibility: context.rebuildVisibility.bind(context),
    feedback: context.feedback.bind(context),
    onActiveSlotChanged: context.onActiveSlotChanged.bind(context),
  });
}

/** Installs all long-lived DOM bindings for the controller. */
export function installControllerLifecycle(context: WorkbenchControllerWiringContext): () => void {
  return installWorkbenchPaneLifecycle({
    pane: context.view.primaryPane,
    signal: context.listenerController.signal,
    interaction: context.interactionController,
    viewport: () => context.viewport,
    boxPreview: context.boxPreview,
    selectionGranularity: () => context.selectionGranularity,
    touchInteractionMode: () => context.touchInteractionMode,
    setActive: context.setActiveSlot.bind(context, "primary"),
  });
}
