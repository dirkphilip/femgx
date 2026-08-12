import type { FemViewport, InteractionState, SceneRuntime } from "../../src/index";
import type { ModelPreset } from "../fixture/presets";
import type { DemoView } from "./view";
import { WorkbenchBoxPreview } from "./box-preview";
import { WorkbenchInteraction } from "./interaction";
import { WorkbenchMenu } from "./menu";
import { WorkbenchPresentation } from "./presentation";
import type { ResultDisplayMode, DisplayToggles } from "./types";
import { VisibilityPanelController } from "./visibility-panel";
import { WorkbenchVisibilityActions } from "./visibility-actions";
import type { VisibilityRowTarget } from "./tree-hover";

export interface WorkbenchFeatureOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: () => FemViewport;
  readonly runtime: () => SceneRuntime;
  readonly preset: () => ModelPreset;
  readonly presets: readonly ModelPreset[];
  readonly toggles: () => DisplayToggles;
  readonly resultMode: () => ResultDisplayMode;
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
  const visibilityActions = new WorkbenchVisibilityActions({
    viewport: options.viewport,
    runtime: options.runtime,
    interaction: options.interaction,
    setInteraction: options.setInteraction,
    applyInteraction: (interaction) => {
      options.setInteraction(interaction);
      options.applyDisplayedInteraction();
    },
    syncPanel: () => {
      visibilityPanel.sync();
    },
    render: options.render,
  });
  const visibilityPanel = new VisibilityPanelController({
    panel: options.view.visibilityPanel,
    getPreset: options.preset,
    getRuntime: options.runtime,
    partName: (partId) => options.preset().partNames.get(partId),
    partVisible: (partId) => visibilityActions.partVisible(partId),
    bodyVisible: (instanceId, bodyId) => visibilityActions.bodyVisible(instanceId, bodyId),
    bodyHighlighted: (instanceId, bodyId) => visibilityActions.bodyHighlighted(instanceId, bodyId),
    onPartVisibility: (partId, visible) => {
      visibilityActions.setPart(partId, visible);
    },
    onBodyVisibility: (instanceId, bodyId, visible) => {
      visibilityActions.setBody(instanceId, bodyId, visible);
    },
    onBodyHighlight: (instanceId, bodyId) => {
      visibilityActions.bodyHighlight(instanceId, bodyId);
    },
    onInstanceVisibility: (instanceId, visible) => {
      visibilityActions.setInstance(instanceId, visible);
    },
    onAssemblyVisibility: (nodeId, visible) => {
      visibilityActions.setAssemblyNode(nodeId, visible);
    },
    onTreeHover: options.setTreeHover,
  });
  const interactionController = new WorkbenchInteraction({
    canvas: options.canvas,
    view: options.view,
    viewport: options.viewport,
    getInteraction: options.interaction,
    setInteraction: options.setInteraction,
    partName: (partId) => options.preset().partNames.get(partId),
    menu,
    render: options.render,
  });
  const presentation = new WorkbenchPresentation({
    view: options.view,
    canvas: options.canvas,
    rendererName: options.rendererName,
    getPreset: options.preset,
    getToggles: options.toggles,
    getResultMode: options.resultMode,
    getInteraction: options.interaction,
    getRuntime: options.runtime,
  });
  return {
    menu,
    visibilityPanel,
    visibilityActions,
    interactionController,
    presentation,
    boxPreview: new WorkbenchBoxPreview(options.view.boxSelectionOverlay),
  };
}
