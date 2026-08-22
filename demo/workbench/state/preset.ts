import {
  createInteractionState,
  setPartOverrides,
  type InteractionState,
} from "@/entries/interaction";
import type { ModelPreset } from "../../fixtures/presets";
import { createExampleModel, modelPartStyleOverrides, type WorkbenchModel } from "../models/model";

/** Creates the deterministic palette state for one demo model preset. */
export function createPresetInteraction(preset: ModelPreset): InteractionState {
  return createModelInteraction(createExampleModel(preset));
}

/** Creates fresh interaction state for the active built-in or imported model. */
export function createModelInteraction(model: WorkbenchModel): InteractionState {
  return setPartOverrides(createInteractionState(), modelPartStyleOverrides(model));
}
