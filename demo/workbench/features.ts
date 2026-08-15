import type { FemViewport, InteractionState, SceneRuntime } from "../../src/index";
import type { DemoView } from "./view";
import type { WorkbenchModel } from "./model";
import { WorkbenchBoxPreview } from "./box-preview";
import { WorkbenchInteraction } from "./interaction";
import { WorkbenchMenu } from "./menu";
import { WorkbenchPresentation } from "./presentation";
import type { ResultDisplayMode, DisplayToggles } from "./types";
import { VisibilityPanelController } from "./visibility-panel";
import { WorkbenchVisibilityActions } from "./visibility-actions";
import type { SelectionGranularity } from "./pick";
import type { SectionAxis } from "./section-controls";
import type { VectorGlyph, VectorTransform } from "./result-controls";
import type { ViewportSlotId } from "./view";
import { hasVisibleSelection } from "./selection";

export interface WorkbenchFeatureOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: () => FemViewport;
  readonly interactionViewport: () => FemViewport;
  readonly viewports: () => readonly FemViewport[];
  readonly runtime: () => SceneRuntime;
  readonly model: () => WorkbenchModel;
  readonly toggles: () => DisplayToggles;
  readonly resultMode: () => ResultDisplayMode;
  readonly vectorFieldId: () => string;
  readonly vectorGlyph: () => VectorGlyph;
  readonly vectorTransform: () => VectorTransform;
  readonly continuous: () => boolean;
  readonly selectionGranularity: () => SelectionGranularity;
  readonly sectionAxis: () => SectionAxis;
  readonly sectionOffset: () => number;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
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
    getRuntime: options.runtime,
    menu,
    publishSnapshot: options.publishSnapshot,
  });
  const visibility = createVisibilityFeatures(options, presentation);
  const interactionController = new WorkbenchInteraction({
    canvas: options.canvas,
    viewport: options.interactionViewport,
    getInteraction: options.interaction,
    setInteraction: options.setInteraction,
    partName: (partId) => options.model().partNames.get(partId),
    menu,
    render: options.render,
    selectionGranularity: options.selectionGranularity,
    setInspection: presentation.setInspection.bind(presentation),
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
  return {
    menu,
    visibilityPanel: visibility.panel,
    visibilityActions: visibility.actions,
    interactionController,
    presentation,
    boxPreview: new WorkbenchBoxPreview(options.view.primaryPane.boxSelectionOverlay),
  };
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
    viewports: options.viewports,
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
    bodyVisible: (instanceId, bodyId) => actions.bodyVisible(instanceId, bodyId),
    bodyHighlighted: (instanceId, bodyId) => actions.bodyHighlighted(instanceId, bodyId),
    onChanged: options.publishSnapshot,
  });
  return { actions, panel };
}
