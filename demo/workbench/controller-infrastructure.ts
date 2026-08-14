import type { FemViewport, InteractionState, SceneRuntime } from "../../src/index";
import type { DemoView } from "./view";
import type { WorkbenchModel } from "./model";
import { applyMenuAction } from "./menu-actions";
import { createWorkbenchFeatures, type WorkbenchFeatures } from "./features";
import { WorkbenchViewportSlots } from "./viewport-slots";
import type { WorkbenchViewportSlot } from "./viewport-slots";
import type { DisplayToggles, ResultDisplayMode, WorkbenchOptions } from "./types";
import type { SelectionGranularity } from "./pick";
import type { SectionAxis } from "./section-controls";
import type { VectorGlyph, VectorTransform } from "./result-controls";

export interface WorkbenchInfrastructureOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: WorkbenchOptions["viewport"];
  readonly createViewport: WorkbenchOptions["createViewport"];
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
  readonly setInteraction: (value: InteractionState) => void;
  readonly activeSlot: () => WorkbenchViewportSlot;
  readonly activeViewport: () => FemViewport;
  readonly viewports: () => readonly FemViewport[];
  readonly runtime: () => SceneRuntime;
  readonly applyDisplayedInteraction: () => void;
  readonly render: () => void;
  readonly publishSnapshot: () => void;
  readonly setEdges: () => void;
  readonly setDiagnostics: () => void;
  readonly fitView: () => void;
  readonly reset: () => void;
  readonly applySharedState: () => void;
  readonly rebuildVisibility: () => void;
  readonly feedback: (message: string) => void;
  readonly onActiveSlotChanged: () => void;
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
    interactionViewport: options.activeViewport,
    viewports: options.viewports,
    runtime: options.runtime,
    model: options.model,
    toggles: options.toggles,
    resultMode: options.resultMode,
    vectorFieldId: options.vectorFieldId,
    vectorGlyph: options.vectorGlyph,
    vectorTransform: options.vectorTransform,
    continuous: options.continuous,
    selectionGranularity: options.selectionGranularity,
    sectionAxis: options.sectionAxis,
    sectionOffset: options.sectionOffset,
    interaction: options.interaction,
    setInteraction: options.setInteraction,
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
    fitView: options.fitView,
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
    getInteraction: options.interaction,
    setInteraction: options.setInteraction,
    selectionGranularity: options.selectionGranularity,
    menu: features.menu,
    render: options.render,
    applySharedState: options.applySharedState,
    rebuildVisibility: options.rebuildVisibility,
    feedback: options.feedback,
    setInspection: features.presentation.setInspection.bind(features.presentation),
    selectionFeedback: features.presentation.setFeedback.bind(features.presentation),
    onActiveSlotChanged: options.onActiveSlotChanged,
  });
}
