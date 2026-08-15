import { createInteractionState, setPartOverride, type InteractionState } from "../../../src/index";
import type { ModelPreset } from "../../fixture/presets";
import { createExampleModel, partStyleOverride, type WorkbenchModel } from "../models/model";

/** Creates the deterministic palette state for one demo model preset. */
export function createPresetInteraction(
  preset: ModelPreset,
  edges = false,
  nodes = false,
): InteractionState {
  return createModelInteraction(createExampleModel(preset), edges, nodes);
}

/** Creates fresh interaction state for the active built-in or imported model. */
export function createModelInteraction(
  model: WorkbenchModel,
  edges = false,
  nodes = false,
): InteractionState {
  let state = createInteractionState();
  for (const partId of model.scene.parts.keys()) {
    state = setPartOverride(state, partId, partStyleOverride(model, partId, edges, nodes));
  }
  return state;
}
