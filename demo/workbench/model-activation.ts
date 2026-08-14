import { setProjection, type InteractionState, type InteractionTarget } from "../../src/index";
import { createModelInteraction } from "./preset";
import {
  clearModelFeedback,
  clearModelInspection,
  setModelLoading,
  type WorkbenchModel,
} from "./model";
import type { DemoView } from "./view";
import type { DisplayToggles, ResultDisplayMode } from "./types";
import type { WorkbenchViewportSlot, WorkbenchViewportSlots } from "./viewport-slots";
import {
  resultModeForModel,
  vectorDisplayForModel,
  type VectorDisplayState,
} from "./result-controls";

export interface WorkbenchModelState {
  model: WorkbenchModel;
  models: readonly WorkbenchModel[];
  toggles: DisplayToggles;
  resultMode: ResultDisplayMode;
  deformationScale: number;
  vectorDisplay: VectorDisplayState;
  sectionAxis: "off" | "x" | "y" | "z";
  sectionOffset: number;
  interaction: InteractionState;
  treeHoverTargets: readonly InteractionTarget[];
}

/** State owner used by the controller-facing activation adapter. */
export interface WorkbenchModelActivationOwner extends WorkbenchModelState {
  readonly view: DemoView;
  readonly examples: readonly WorkbenchModel[];
  readonly viewportSlots: WorkbenchViewportSlots;
  readonly presentation: { populateModelSelect: (models: readonly WorkbenchModel[]) => void };
  readonly visibilityPanel: { rebuild: () => void };
  applyResultMode: (render: boolean) => void;
  applyCurrentDisplayState: () => void;
  render: () => void;
}

/** Activates a model using the controller's state and lifecycle owners. */
export function activateModelForOwner(
  model: WorkbenchModel,
  owner: WorkbenchModelActivationOwner,
): void {
  activateControllerModel(model, {
    view: owner.view,
    examples: owner.examples,
    slots: owner.viewportSlots.all(),
    state: owner,
    setControllerState: (next) => {
      owner.model = next.model;
      owner.models = next.models;
      owner.toggles = next.toggles;
      owner.resultMode = next.resultMode;
      owner.deformationScale = next.deformationScale;
      owner.vectorDisplay = next.vectorDisplay;
      owner.sectionAxis = next.sectionAxis;
      owner.sectionOffset = next.sectionOffset;
      owner.interaction = next.interaction;
      owner.treeHoverTargets = next.treeHoverTargets;
    },
    applyResultMode: () => {
      owner.applyResultMode(false);
    },
    applyDisplayState: () => {
      owner.applyCurrentDisplayState();
    },
    rebuildVisibility: () => {
      owner.visibilityPanel.rebuild();
    },
    populateModelSelect: (models) => {
      owner.presentation.populateModelSelect(models);
    },
    render: () => {
      owner.render();
    },
  });
}

export interface WorkbenchModelControllerContext {
  readonly view: DemoView;
  readonly examples: readonly WorkbenchModel[];
  readonly slots: readonly WorkbenchViewportSlot[];
  readonly state: WorkbenchModelState;
  readonly setControllerState: (state: WorkbenchModelState) => void;
  readonly applyResultMode: () => void;
  readonly applyDisplayState: () => void;
  readonly rebuildVisibility: () => void;
  readonly populateModelSelect: (models: readonly WorkbenchModel[]) => void;
  readonly render: () => void;
}

/** Bridges controller properties to the model activation workflow. */
export function activateControllerModel(
  model: WorkbenchModel,
  context: WorkbenchModelControllerContext,
): void {
  const syncState = (): void => {
    context.setControllerState(context.state);
  };
  activateWorkbenchModel({
    view: context.view,
    examples: context.examples,
    slots: context.slots,
    state: context.state,
    model,
    applyResultMode: () => {
      syncState();
      context.applyResultMode();
    },
    applyDisplayState: () => {
      syncState();
      context.applyDisplayState();
    },
    rebuildVisibility: context.rebuildVisibility,
    populateModelSelect: context.populateModelSelect,
    render: () => {
      syncState();
      context.render();
    },
  });
  syncState();
}

interface ActivateWorkbenchModelOptions {
  readonly view: DemoView;
  readonly examples: readonly WorkbenchModel[];
  readonly slots: readonly WorkbenchViewportSlot[];
  readonly state: WorkbenchModelState;
  readonly model: WorkbenchModel;
  readonly applyResultMode: () => void;
  readonly applyDisplayState: () => void;
  readonly rebuildVisibility: () => void;
  readonly populateModelSelect: (models: readonly WorkbenchModel[]) => void;
  readonly render: () => void;
}

/** Applies one model to every viewport and restores the inspection defaults. */
export function activateWorkbenchModel(options: ActivateWorkbenchModelOptions): void {
  setModelLoading(options.view, false);
  const { state, model } = options;
  resetSlotRenderLoops(options.slots);
  state.model = model;
  state.models = model.source === "file" ? [...options.examples, model] : options.examples;
  state.treeHoverTargets = [];
  state.toggles = { edges: true, nodes: true, diagnostics: false };
  state.resultMode = resultModeForModel(model);
  state.deformationScale = model.results?.deformation?.scale ?? 1;
  const vectorDisplay = vectorDisplayForModel(model);
  state.vectorDisplay = vectorDisplay;
  state.sectionAxis = "off";
  state.sectionOffset = 0;
  state.interaction = createModelInteraction(model, true, true);
  setModelScene(options.slots, model);
  options.applyResultMode();
  options.applyDisplayState();
  resetSlotVisibility(options.slots, model);
  options.rebuildVisibility();
  options.populateModelSelect(state.models);
  for (const slot of options.slots) slot.pane.canvas.dataset["model"] = model.id;
  clearModelFeedback(options.view);
  clearModelInspection(options.view, model);
  options.render();
}

function resetSlotRenderLoops(slots: readonly WorkbenchViewportSlot[]): void {
  const now = performance.now();
  for (const slot of slots) slot.renderLoop.reset(now);
}

function setModelScene(slots: readonly WorkbenchViewportSlot[], model: WorkbenchModel): void {
  for (const slot of slots) {
    slot.interaction.clearContext();
    slot.viewport.batch(() => {
      slot.viewport.clearSectionPlane();
      slot.viewport.setScene(model.scene);
    });
  }
}

function resetSlotVisibility(slots: readonly WorkbenchViewportSlot[], model: WorkbenchModel): void {
  for (const slot of slots) {
    const runtime = slot.viewport.runtime;
    slot.viewport.batch(() => {
      for (const occurrenceId of runtime.getOccurrenceIds()) {
        slot.viewport.setAssemblyOccurrenceVisible(occurrenceId, true);
      }
      for (const partId of model.scene.parts.keys()) slot.viewport.setPartVisible(partId, true);
      for (const instanceId of runtime.getInstanceIds()) {
        slot.viewport.setInstanceVisible(instanceId, true);
      }
      slot.viewport.setCamera(setProjection(slot.viewport.camera, "orthographic"));
      slot.viewport.fitView();
    });
  }
}
