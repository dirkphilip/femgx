import {
  createInteractionState,
  setPartOverrides,
  type InteractionState,
} from "../../../src/entries/root";
import type { ModelPreset } from "../../fixtures/presets";
import { createExampleModel, modelPartStyleOverrides, type WorkbenchModel } from "../models/model";

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
  return setPartOverrides(createInteractionState(), modelPartStyleOverrides(model, edges, nodes));
}
