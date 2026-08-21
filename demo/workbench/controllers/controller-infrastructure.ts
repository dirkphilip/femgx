import type { Viewport } from "@/entries/root";
import type { InteractionState } from "@/entries/interaction";
import type { SceneOccurrences } from "@/entries/root";
import { installWorkbenchPaneLifecycle } from "../lifecycle";
import type { DemoView, ViewportSlotId } from "../viewport/view";
import type { WorkbenchModel } from "../models/model";
import { applyMenuAction } from "../interaction/menu-actions";
import { createWorkbenchFeatures, type WorkbenchFeatures } from "../state/features";
import { WorkbenchViewportSlots } from "../viewport/viewport-slots";
import type { WorkbenchViewportSlot } from "../viewport/viewport-slots";
import type { WorkbenchInteraction } from "../interaction/interaction";
import type { WorkbenchBoxPreview } from "../selection/box-preview";
import type {
  DisplayToggles,
  ResultDisplayMode,
  TouchInteractionMode,
  WorkbenchOptions,
} from "../types";
import type { SelectionGranularity } from "../selection/pick";
import type { SelectTarget } from "../selection/pick";
import type { BoxSelectionStrategy } from "../selection/box-selection-resolver";
import type { SectionAxis } from "../section-controls";
import type { VectorDisplayState } from "../results/result-controls";
import { applyBoxSelectionResolvers } from "./controller-box-selection";

/** The controller-owned values and transitions used to compose workbench features. */
export interface WorkbenchControllerComposition {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: Viewport;
  readonly model: WorkbenchModel;
  readonly toggles: DisplayToggles;
  readonly resultMode: ResultDisplayMode;
  readonly vectorDisplay: VectorDisplayState;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly selectionGranularityForSlot: (slotId: ViewportSlotId) => SelectionGranularity;
  readonly touchInteractionMode: TouchInteractionMode;
  readonly touchInteractionModeForSlot: (slotId: ViewportSlotId) => TouchInteractionMode;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
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
  readonly runtime: SceneOccurrences;
  readonly applyDisplayedInteraction: () => void;
  readonly render: () => void;
  readonly publishSnapshot: () => void;
  readonly setEdges: () => void;
  readonly setDiagnostics: () => void;
  readonly fitSelection: () => void;
  readonly reset: () => void;
  readonly openLivePartDialog: (kind: "add" | "instance", partId?: number) => void;
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
  context: WorkbenchControllerComposition,
  createViewport: WorkbenchOptions["createViewport"],
): WorkbenchInfrastructure {
  const features: { current?: WorkbenchFeatures } = {};
  const createdFeatures = createWorkbenchFeatures({
    view: context.view,
    canvas: context.canvas,
    rendererName: context.rendererName,
    viewport: context.activeViewport.bind(context),
    interactionViewport: () => context.viewport,
    runtime: () => context.runtime,
    model: () => context.model,
    toggles: () => context.toggles,
    resultMode: () => context.resultMode,
    vectorFieldId: () => context.vectorDisplay.fieldId,
    vectorGlyph: () => context.vectorDisplay.glyph,
    vectorTransform: () => context.vectorDisplay.transform,
    continuous: () => context.continuousEnabled,
    selectionGranularity: () => context.selectionGranularity,
    touchInteractionMode: () => context.touchInteractionMode,
    sectionAxis: () => context.sectionAxis,
    sectionOffset: () => context.sectionOffset,
    interaction: () => context.interactionForSlot("primary"),
    setInteraction: (value) => {
      context.setInteractionForSlot("primary", value);
    },
    getInspection: context.getInspection.bind(context),
    setInspection: context.setInspection.bind(context),
    setInspectionForSlot: context.setInspectionForSlot.bind(context),
    hoverSlotId: "primary",
    canClearCanvasHover: context.canClearCanvasHover.bind(context),
    markCanvasHover: context.markCanvasHover.bind(context),
    clearCanvasHover: context.clearCanvasHover.bind(context),
    applyDisplayedInteraction: context.applyDisplayedInteraction.bind(context),
    render: context.render.bind(context),
    publishSnapshot: context.publishSnapshot.bind(context),
    applyMenuAction: (action) => {
      applyControllerMenuAction(action, context, features.current);
    },
  });
  features.current = createdFeatures;
  const viewportSlots = createViewportSlots(context, createViewport, createdFeatures);
  applyBoxSelectionResolvers({
    boxSelectionStrategy: context.boxSelectionStrategy,
    selectionGranularity: context.selectionGranularity,
    viewportSlots,
    render: context.render.bind(context),
  });
  return {
    features: createdFeatures,
    viewportSlots,
  };
}

function applyControllerMenuAction(
  action: string,
  context: WorkbenchControllerComposition,
  features: WorkbenchFeatures | undefined,
): void {
  if (features === undefined) throw new Error("Workbench features are not initialized");
  const slot = context.activeSlot();
  applyMenuAction(action, {
    target: slot.interaction.contextTarget,
    interaction: slot.interaction,
    visibilityActions: features.visibilityActions,
    toggles: context.toggles,
    setEdges: context.setEdges.bind(context),
    setDiagnostics: context.setDiagnostics.bind(context),
    fitSelection: context.fitSelection.bind(context),
    reset: context.reset.bind(context),
    addMesh: () => {
      context.openLivePartDialog("add");
    },
    instancePart: () => {
      const source = partIdForTarget(slot, slot.interaction.contextTarget);
      if (source !== undefined) context.openLivePartDialog("instance", source);
    },
  });
  slot.interaction.clearContext();
}

function partIdForTarget(
  slot: WorkbenchViewportSlot,
  target: SelectTarget | undefined,
): number | undefined {
  if (target === undefined) return undefined;
  if (target.kind === "part") return target.partId;
  return slot.viewport.occurrences.getPartOccurrence(target.partOccurrenceId)?.partId;
}

function createViewportSlots(
  context: WorkbenchControllerComposition,
  createViewport: WorkbenchOptions["createViewport"],
  features: WorkbenchFeatures,
): WorkbenchViewportSlots {
  return new WorkbenchViewportSlots({
    view: context.view,
    primaryViewport: context.viewport,
    primaryInteraction: features.interactionController,
    primaryBoxPreview: features.boxPreview,
    createViewport,
    getModel: () => context.model,
    getInteraction: context.interactionForSlot.bind(context),
    setInteraction: context.setInteractionForSlot.bind(context),
    canClearCanvasHover: context.canClearCanvasHover.bind(context),
    markCanvasHover: context.markCanvasHover.bind(context),
    clearCanvasHover: context.clearCanvasHover.bind(context),
    selectionGranularity: context.selectionGranularityForSlot.bind(context),
    touchInteractionMode: context.touchInteractionModeForSlot.bind(context),
    menu: features.menu,
    render: context.render.bind(context),
    applyActiveState: context.applyActiveState.bind(context),
    applyState: context.applyState.bind(context),
    cloneShowState: context.cloneShowState.bind(context),
    removeShowState: context.removeShowState.bind(context),
    rebuildVisibility: context.rebuildVisibility.bind(context),
    feedback: context.feedback.bind(context),
    setInspection: (slotId, text, visible) => {
      context.setInspectionForSlot(slotId, { text, visible });
    },
    selectionFeedback: features.presentation.setFeedback.bind(features.presentation),
    onActiveSlotChanged: context.onActiveSlotChanged.bind(context),
  });
}

/** Installs the primary pane lifecycle after its feature owners are composed. */
export function installControllerLifecycle(context: {
  readonly view: DemoView;
  readonly listenerController: AbortController;
  readonly interactionController: WorkbenchInteraction;
  readonly viewport: Viewport;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly selectionGranularity: SelectionGranularity;
  readonly touchInteractionMode: TouchInteractionMode;
  readonly setActiveSlot: (slotId: "primary") => void;
}): () => void {
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
