import type { Viewport, InteractionState } from "../../../src/entries/root";
import type { SceneRuntime } from "../../../src/entries/runtime";
import type { DemoView, ViewportSlotId } from "../viewport/view";
import type { WorkbenchModel } from "../models/model";
import { applyMenuAction } from "../interaction/menu-actions";
import { createWorkbenchFeatures, type WorkbenchFeatures } from "../state/features";
import { WorkbenchViewportSlots } from "../viewport/viewport-slots";
import type { WorkbenchViewportSlot } from "../viewport/viewport-slots";
import type {
  DisplayToggles,
  ResultDisplayMode,
  TouchInteractionMode,
  WorkbenchOptions,
} from "../types";
import type { SelectionGranularity } from "../selection/pick";
import type { SectionAxis } from "../section-controls";
import type { VectorGlyph, VectorTransform } from "../results/result-controls";

export interface WorkbenchInfrastructureOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: WorkbenchOptions["viewport"];
  readonly primaryViewport: () => Viewport;
  readonly createViewport: WorkbenchOptions["createViewport"];
  readonly model: () => WorkbenchModel;
  readonly toggles: () => DisplayToggles;
  readonly resultMode: () => ResultDisplayMode;
  readonly vectorFieldId: () => string;
  readonly vectorGlyph: () => VectorGlyph;
  readonly vectorTransform: () => VectorTransform;
  readonly continuous: () => boolean;
  readonly selectionGranularity: () => SelectionGranularity;
  readonly selectionGranularityForSlot: (slotId: ViewportSlotId) => SelectionGranularity;
  readonly touchInteractionMode: () => TouchInteractionMode;
  readonly touchInteractionModeForSlot: (slotId: ViewportSlotId) => TouchInteractionMode;
  readonly sectionAxis: () => SectionAxis;
  readonly sectionOffset: () => number;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (value: InteractionState) => void;
  readonly getInspection: () => { readonly visible: boolean; readonly text: string };
  readonly setInspection: (value: { readonly visible: boolean; readonly text: string }) => void;
  readonly setInspectionForSlot: (
    slotId: ViewportSlotId,
    value: { readonly visible: boolean; readonly text: string },
  ) => void;
  readonly interactionForSlot: (slotId: ViewportSlotId) => InteractionState;
  readonly setInteractionForSlot: (slotId: ViewportSlotId, value: InteractionState) => void;
  readonly canClearCanvasHover: (slotId: ViewportSlotId) => boolean;
  readonly markCanvasHover: (slotId: ViewportSlotId) => void;
  readonly clearCanvasHover: (slotId: ViewportSlotId) => void;
  readonly activeSlot: () => WorkbenchViewportSlot;
  readonly activeViewport: () => Viewport;
  readonly viewports: () => readonly Viewport[];
  readonly runtime: () => SceneRuntime;
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
}

export interface WorkbenchInfrastructure {
  readonly features: WorkbenchFeatures;
  readonly viewportSlots: WorkbenchViewportSlots;
}

/** Creates feature owners first, then gives them one shared slot manager. */
export function createWorkbenchInfrastructure(
  options: WorkbenchInfrastructureOptions,
): WorkbenchInfrastructure {
  const features: { current?: WorkbenchFeatures } = {};
  const createdFeatures = createWorkbenchFeatures({
    view: options.view,
    canvas: options.canvas,
    rendererName: options.rendererName,
    viewport: options.activeViewport,
    interactionViewport: options.primaryViewport,
    runtime: options.runtime,
    model: options.model,
    toggles: options.toggles,
    resultMode: options.resultMode,
    vectorFieldId: options.vectorFieldId,
    vectorGlyph: options.vectorGlyph,
    vectorTransform: options.vectorTransform,
    continuous: options.continuous,
    selectionGranularity: options.selectionGranularity,
    touchInteractionMode: options.touchInteractionMode,
    sectionAxis: options.sectionAxis,
    sectionOffset: options.sectionOffset,
    interaction: () => options.interactionForSlot("primary"),
    setInteraction: (value) => {
      options.setInteractionForSlot("primary", value);
    },
    getInspection: options.getInspection,
    setInspection: options.setInspection,
    setInspectionForSlot: options.setInspectionForSlot,
    hoverSlotId: "primary",
    canClearCanvasHover: options.canClearCanvasHover,
    markCanvasHover: options.markCanvasHover,
    clearCanvasHover: options.clearCanvasHover,
    applyDisplayedInteraction: options.applyDisplayedInteraction,
    render: options.render,
    publishSnapshot: options.publishSnapshot,
    applyMenuAction: (action) => {
      applyControllerMenuAction(action, options, features.current);
    },
  });
  features.current = createdFeatures;
  return {
    features: createdFeatures,
    viewportSlots: createViewportSlots(options, createdFeatures),
  };
}

function applyControllerMenuAction(
  action: string,
  options: WorkbenchInfrastructureOptions,
  features: WorkbenchFeatures | undefined,
): void {
  if (features === undefined) throw new Error("Workbench features are not initialized");
  const slot = options.activeSlot();
  applyMenuAction(action, {
    target: slot.interaction.contextTarget,
    interaction: slot.interaction,
    visibilityActions: features.visibilityActions,
    toggles: options.toggles(),
    setEdges: options.setEdges,
    setDiagnostics: options.setDiagnostics,
    fitSelection: options.fitSelection,
    reset: options.reset,
  });
  slot.interaction.clearContext();
}

function createViewportSlots(
  options: WorkbenchInfrastructureOptions,
  features: WorkbenchFeatures,
): WorkbenchViewportSlots {
  return new WorkbenchViewportSlots({
    view: options.view,
    primaryViewport: options.viewport,
    primaryInteraction: features.interactionController,
    primaryBoxPreview: features.boxPreview,
    createViewport: options.createViewport,
    getModel: options.model,
    getInteraction: options.interactionForSlot,
    setInteraction: options.setInteractionForSlot,
    canClearCanvasHover: options.canClearCanvasHover,
    markCanvasHover: options.markCanvasHover,
    clearCanvasHover: options.clearCanvasHover,
    selectionGranularity: options.selectionGranularityForSlot,
    touchInteractionMode: options.touchInteractionModeForSlot,
    menu: features.menu,
    render: options.render,
    applyActiveState: options.applyActiveState,
    applyState: options.applyState,
    cloneShowState: options.cloneShowState,
    removeShowState: options.removeShowState,
    rebuildVisibility: options.rebuildVisibility,
    feedback: options.feedback,
    setInspection: (slotId, text, visible) => {
      options.setInspectionForSlot(slotId, { text, visible });
    },
    selectionFeedback: features.presentation.setFeedback.bind(features.presentation),
    onActiveSlotChanged: options.onActiveSlotChanged,
  });
}
