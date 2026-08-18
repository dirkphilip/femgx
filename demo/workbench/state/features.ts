import type { Viewport } from "../../../src/entries/root";
import type { InteractionState } from "../../../src/entries/interaction";
import type { SceneRuntime } from "../../../src/entries/runtime";
import type { DemoView } from "../viewport/view";
import type { WorkbenchModel } from "../models/model";
import { WorkbenchBoxPreview } from "../selection/box-preview";
import { WorkbenchInteraction } from "../interaction/interaction";
import { WorkbenchMenu } from "../interaction/menu";
import { WorkbenchPresentation } from "../viewport/presentation";
import type { ResultDisplayMode, DisplayToggles, TouchInteractionMode } from "../types";
import { VisibilityPanelController } from "./visibility-panel";
import { WorkbenchVisibilityActions } from "./visibility-actions";
import type { SelectionGranularity } from "../selection/pick";
import type { SectionAxis } from "../section-controls";
import type { VectorGlyph, VectorTransform } from "../results/result-controls";
import type { ViewportSlotId } from "../viewport/view";
import { hasVisibleSelection } from "../selection/selection";

export interface WorkbenchFeatureOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: () => Viewport;
  readonly interactionViewport: () => Viewport;
  readonly runtime: () => SceneRuntime;
  readonly model: () => WorkbenchModel;
  readonly toggles: () => DisplayToggles;
  readonly resultMode: () => ResultDisplayMode;
  readonly vectorFieldId: () => string;
  readonly vectorGlyph: () => VectorGlyph;
  readonly vectorTransform: () => VectorTransform;
  readonly continuous: () => boolean;
  readonly selectionGranularity: () => SelectionGranularity;
  readonly touchInteractionMode: () => TouchInteractionMode;
  readonly sectionAxis: () => SectionAxis;
  readonly sectionOffset: () => number;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly getInspection: () => { readonly visible: boolean; readonly text: string };
  readonly setInspection: (value: { readonly visible: boolean; readonly text: string }) => void;
  readonly setInspectionForSlot: (
    slotId: ViewportSlotId,
    value: { readonly visible: boolean; readonly text: string },
  ) => void;
  readonly hoverSlotId: ViewportSlotId;
  readonly canClearCanvasHover: (slotId: ViewportSlotId) => boolean;
  readonly markCanvasHover: (slotId: ViewportSlotId) => void;
  readonly clearCanvasHover: (slotId: ViewportSlotId) => void;
  readonly applyDisplayedInteraction: () => void;
  readonly render: () => void;
  readonly publishSnapshot: () => void;
  readonly applyMenuAction: (action: string) => void;
}

export interface WorkbenchFeatures {
  readonly menu: WorkbenchMenu;
  readonly visibilityPanel: VisibilityPanelController;
  readonly visibilityActions: WorkbenchVisibilityActions;
  readonly interactionController: WorkbenchInteraction;
  readonly presentation: WorkbenchPresentation;
  readonly boxPreview: WorkbenchBoxPreview;
}

/** Composes the existing workbench feature owners around one controller context. */
export function createWorkbenchFeatures(options: WorkbenchFeatureOptions): WorkbenchFeatures {
  const menu = new WorkbenchMenu(
    () => options.toggles().edges,
    () => options.toggles().diagnostics,
    () => hasVisibleSelection(options.interaction(), options.runtime()),
    options.applyMenuAction,
    options.publishSnapshot,
  );
  const presentation = new WorkbenchPresentation({
    canvas: options.canvas,
    rendererName: options.rendererName,
    getModel: options.model,
    getToggles: options.toggles,
    getResultMode: options.resultMode,
    getVectorFieldId: options.vectorFieldId,
    getVectorGlyph: options.vectorGlyph,
    getVectorTransform: options.vectorTransform,
    getViewport: options.viewport,
    getSectionAxis: options.sectionAxis,
    getSectionOffset: options.sectionOffset,
    getInteraction: options.interaction,
    getInspection: options.getInspection,
    setInspection: options.setInspection,
    getRuntime: options.runtime,
    menu,
    publishSnapshot: options.publishSnapshot,
  });
  const visibility = createVisibilityFeatures(options, presentation);
  const interactionController = createPrimaryInteraction(options, menu, presentation);
  return {
    menu,
    visibilityPanel: visibility.panel,
    visibilityActions: visibility.actions,
    interactionController,
    presentation,
    boxPreview: new WorkbenchBoxPreview(options.view.primaryPane.boxSelectionOverlay),
  };
}

function createPrimaryInteraction(
  options: WorkbenchFeatureOptions,
  menu: WorkbenchMenu,
  presentation: WorkbenchPresentation,
): WorkbenchInteraction {
  return new WorkbenchInteraction({
    canvas: options.canvas,
    viewport: options.interactionViewport,
    getInteraction: options.interaction,
    setInteraction: options.setInteraction,
    partName: (partId) => options.model().partNames.get(partId),
    menu,
    render: () => {
      const primaryViewport = options.interactionViewport();
      if (primaryViewport !== options.viewport()) {
        primaryViewport.interaction.set(options.interaction());
        primaryViewport.render();
      }
      options.render();
    },
    selectionGranularity: options.selectionGranularity,
    touchMode: options.touchInteractionMode,
    setInspection: (text, visible) => {
      options.setInspectionForSlot("primary", { text, visible });
    },
    selectionFeedback: presentation.setFeedback.bind(presentation),
    hoverOwnership: {
      canClear: () => {
        return options.canClearCanvasHover(options.hoverSlotId);
      },
      mark: () => {
        options.markCanvasHover(options.hoverSlotId);
      },
      clear: () => {
        options.clearCanvasHover(options.hoverSlotId);
      },
    },
  });
}

function createVisibilityFeatures(
  options: WorkbenchFeatureOptions,
  presentation: WorkbenchPresentation,
): {
  readonly actions: WorkbenchVisibilityActions;
  readonly panel: VisibilityPanelController;
} {
  const actions = new WorkbenchVisibilityActions({
    viewport: options.viewport,
    scene: () => options.model().scene,
    runtime: options.runtime,
    interaction: options.interaction,
    setInteraction: options.setInteraction,
    applyInteraction: (interaction) => {
      options.setInteraction(interaction);
      options.applyDisplayedInteraction();
    },
    syncPanel: () => {
      panel.sync();
    },
    render: options.render,
    feedback: presentation.setFeedback.bind(presentation),
  });
  const panel = new VisibilityPanelController({
    getModel: options.model,
    getRuntime: options.runtime,
    partName: (partId) => options.model().partNames.get(partId),
    partVisible: (partId) => actions.partVisible(partId),
    bodyVisible: (partOccurrenceId, bodyId) => actions.bodyVisible(partOccurrenceId, bodyId),
    bodyHighlighted: (partOccurrenceId, bodyId) =>
      actions.bodyHighlighted(partOccurrenceId, bodyId),
    onChanged: options.publishSnapshot,
  });
  return { actions, panel };
}
