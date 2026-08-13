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
import type { WorkbenchViewportSlot } from "./viewport-slots";

export interface WorkbenchModelState {
  model: WorkbenchModel;
  models: readonly WorkbenchModel[];
  toggles: DisplayToggles;
  resultMode: ResultDisplayMode;
  interaction: InteractionState;
  treeHoverTargets: readonly InteractionTarget[];
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
  state.resultMode = model.results === undefined ? "base" : "deformed";
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
      slot.viewport.setScene(model.scene);
    });
  }
}

function resetSlotVisibility(slots: readonly WorkbenchViewportSlot[], model: WorkbenchModel): void {
  for (const slot of slots) {
    const runtime = slot.viewport.runtime;
    slot.viewport.batch(() => {
      for (const nodeId of runtime.getNodeIds()) slot.viewport.setAssemblyNodeVisible(nodeId, true);
      for (const partId of model.scene.parts.keys()) slot.viewport.setPartVisible(partId, true);
      for (const instanceId of runtime.getInstanceIds()) {
        slot.viewport.setInstanceVisible(instanceId, true);
      }
      slot.viewport.setCamera(setProjection(slot.viewport.camera, "orthographic"));
      slot.viewport.fitView();
    });
  }
}
