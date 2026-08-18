import { setProjection } from "../../../src/entries/camera";
import type { InteractionState } from "../../../src/entries/root";
import { createModelInteraction } from "../state/preset";
import type { WorkbenchModel } from "./model";
import type { WorkbenchPresentation } from "../viewport/presentation";
import type { DisplayToggles, ResultDisplayMode } from "../types";
import { createDefaultDisplayToggles } from "../types";
import type { WorkbenchViewportSlot, WorkbenchViewportSlots } from "../viewport/viewport-slots";
import {
  activeScalarFieldIdForModel,
  resultModeForModel,
  vectorDisplayForModel,
  type VectorDisplayState,
} from "../results/result-controls";

export interface WorkbenchModelState {
  model: WorkbenchModel;
  models: readonly WorkbenchModel[];
  toggles: DisplayToggles;
  resultMode: ResultDisplayMode;
  scalarFieldId: string;
  deformationScale: number;
  vectorDisplay: VectorDisplayState;
  sectionAxis: "off" | "x" | "y" | "z";
  sectionOffset: number;
  interaction: InteractionState;
}

/** State owner used by the controller-facing activation adapter. */
export interface WorkbenchModelActivationOwner extends WorkbenchModelState {
  readonly viewportSlots: WorkbenchViewportSlots;
  readonly presentation: WorkbenchPresentation;
  readonly visibilityPanel: { rebuild: () => void };
  applyState: (slotId: WorkbenchViewportSlot["id"]) => void;
  render: () => void;
}

/** Activates a model using the controller's state and lifecycle owners. */
export function activateModelForOwner(
  model: WorkbenchModel,
  owner: WorkbenchModelActivationOwner,
): void {
  activateControllerModel(model, {
    catalogModels: owner.models,
    slots: owner.viewportSlots.all(),
    state: owner,
    presentation: owner.presentation,
    setControllerState: (next) => {
      owner.model = next.model;
      owner.models = next.models;
      owner.toggles = next.toggles;
      owner.resultMode = next.resultMode;
      owner.scalarFieldId = next.scalarFieldId;
      owner.deformationScale = next.deformationScale;
      owner.vectorDisplay = next.vectorDisplay;
      owner.sectionAxis = next.sectionAxis;
      owner.sectionOffset = next.sectionOffset;
      owner.interaction = next.interaction;
    },
    applyState: owner.applyState.bind(owner),
    rebuildVisibility: () => {
      owner.visibilityPanel.rebuild();
    },
    render: () => {
      owner.render();
    },
  });
}

export interface WorkbenchModelControllerContext {
  readonly catalogModels: readonly WorkbenchModel[];
  readonly slots: readonly WorkbenchViewportSlot[];
  readonly state: WorkbenchModelState;
  readonly presentation: WorkbenchPresentation;
  readonly setControllerState: (state: WorkbenchModelState) => void;
  readonly applyState: (slotId: WorkbenchViewportSlot["id"]) => void;
  readonly rebuildVisibility: () => void;
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
    catalogModels: context.catalogModels,
    slots: context.slots,
    state: context.state,
    model,
    presentation: context.presentation,
    applyState: (slotId) => {
      syncState();
      context.applyState(slotId);
    },
    rebuildVisibility: context.rebuildVisibility,
    render: () => {
      syncState();
      context.render();
    },
  });
  syncState();
}

interface ActivateWorkbenchModelOptions {
  readonly catalogModels: readonly WorkbenchModel[];
  readonly slots: readonly WorkbenchViewportSlot[];
  readonly state: WorkbenchModelState;
  readonly model: WorkbenchModel;
  readonly presentation: WorkbenchPresentation;
  readonly applyState: (slotId: WorkbenchViewportSlot["id"]) => void;
  readonly rebuildVisibility: () => void;
  readonly render: () => void;
}

/** Applies one model to every viewport and restores the inspection defaults. */
export function activateWorkbenchModel(options: ActivateWorkbenchModelOptions): void {
  options.presentation.setLoading(false);
  const { state, model } = options;
  resetSlotRenderLoops(options.slots);
  state.model = model;
  const catalogModels = options.catalogModels.some((candidate) => candidate.id === model.id)
    ? options.catalogModels
    : [...options.catalogModels, model];
  state.models = model.source === "file" ? catalogModels : options.catalogModels;
  state.toggles = createDefaultDisplayToggles(model);
  state.resultMode = resultModeForModel(model);
  state.scalarFieldId = activeScalarFieldIdForModel(model);
  state.deformationScale = model.results?.deformation?.scale ?? 1;
  const vectorDisplay = vectorDisplayForModel(model);
  state.vectorDisplay = vectorDisplay;
  state.sectionAxis = "off";
  state.sectionOffset = 0;
  state.interaction = createModelInteraction(model, true, true);
  setModelScene(options.slots, model);
  for (const slot of options.slots) options.applyState(slot.id);
  resetSlotVisibility(options.slots, model);
  options.rebuildVisibility();
  for (const slot of options.slots) slot.pane.canvas.dataset["model"] = model.id;
  options.presentation.clearFeedback();
  options.presentation.clearInspection(model);
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
      slot.viewport.presentation.clearSectionPlane();
      slot.viewport.replaceScene(model.scene);
    });
  }
}

function resetSlotVisibility(slots: readonly WorkbenchViewportSlot[], model: WorkbenchModel): void {
  for (const slot of slots) {
    const runtime = slot.viewport.runtime;
    slot.viewport.batch(() => {
      for (const occurrenceId of runtime.getOccurrenceIds()) {
        slot.viewport.visibility.setAssemblyOccurrence(occurrenceId, true);
      }
      for (const partId of model.scene.parts.keys()) slot.viewport.visibility.setPart(partId, true);
      for (const partOccurrenceId of runtime.getPartOccurrenceIds()) {
        slot.viewport.visibility.setPartOccurrence(partOccurrenceId, true);
      }
      slot.viewport.view.setCamera(setProjection(slot.viewport.view.camera, "orthographic"));
      slot.viewport.view.fit();
    });
  }
}
