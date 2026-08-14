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
import type { VisibilityRowTarget } from "./tree-hover";
import { setModelFeedback } from "./model";
import type { SelectionGranularity } from "./pick";

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
  readonly deformationScale: () => number;
  readonly continuous: () => boolean;
  readonly selectionGranularity: () => SelectionGranularity;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly applyDisplayedInteraction: () => void;
  readonly render: () => void;
  readonly setTreeHover: (target: VisibilityRowTarget | undefined) => void;
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
    options.view.contextMenu,
    () => options.toggles().edges,
    () => options.toggles().diagnostics,
    options.applyMenuAction,
  );
  const visibility = createVisibilityFeatures(options);
  const interactionController = new WorkbenchInteraction({
    canvas: options.canvas,
    view: options.view,
    viewport: options.interactionViewport,
    getInteraction: options.interaction,
    setInteraction: options.setInteraction,
    partName: (partId) => options.model().partNames.get(partId),
    menu,
    render: options.render,
    selectionGranularity: options.selectionGranularity,
    selectionFeedback: (message) => {
      setModelFeedback(options.view, message);
    },
  });
  const presentation = new WorkbenchPresentation({
    view: options.view,
    canvas: options.canvas,
    rendererName: options.rendererName,
    getModel: options.model,
    getToggles: options.toggles,
    getResultMode: options.resultMode,
    getDeformationScale: options.deformationScale,
    getViewport: options.viewport,
    getContinuous: options.continuous,
    getSelectionGranularity: options.selectionGranularity,
    getInteraction: options.interaction,
    getRuntime: options.runtime,
  });
  return {
    menu,
    visibilityPanel: visibility.panel,
    visibilityActions: visibility.actions,
    interactionController,
    presentation,
    boxPreview: new WorkbenchBoxPreview(options.view.boxSelectionOverlay),
  };
}

function createVisibilityFeatures(options: WorkbenchFeatureOptions): {
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
    feedback: (message) => {
      setModelFeedback(options.view, message);
    },
  });
  const panel = new VisibilityPanelController({
    panel: options.view.visibilityPanel,
    getModel: options.model,
    getRuntime: options.runtime,
    partName: (partId) => options.model().partNames.get(partId),
    partVisible: (partId) => actions.partVisible(partId),
    bodyVisible: (instanceId, bodyId) => actions.bodyVisible(instanceId, bodyId),
    bodyHighlighted: (instanceId, bodyId) => actions.bodyHighlighted(instanceId, bodyId),
    onPartVisibility: (partId, visible) => {
      actions.setPart(partId, visible);
    },
    onBodyVisibility: (instanceId, bodyId, visible) => {
      actions.setBody(instanceId, bodyId, visible);
    },
    onBodyHighlight: (instanceId, bodyId) => {
      actions.bodyHighlight(instanceId, bodyId);
    },
    onInstanceVisibility: (instanceId, visible) => {
      actions.setInstance(instanceId, visible);
    },
    onAssemblyVisibility: (nodeId, visible) => {
      actions.setAssemblyNode(nodeId, visible);
    },
    onTreeHover: options.setTreeHover,
  });
  return { actions, panel };
}
