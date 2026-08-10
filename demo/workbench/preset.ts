import {
  createInteractionState,
  setPartOverride,
  type Color,
  type InteractionState,
  type PartId,
} from "../../src/index";
import type { ModelPreset } from "../fixture/presets";

/** Creates the deterministic palette state for one demo model preset. */
export function createPresetInteraction(preset: ModelPreset): InteractionState {
  let state = createInteractionState();
  for (const partId of preset.scene.parts.keys()) {
    state = setPartOverride(state, partId, {
      color: preset.partColors.get(partId) ?? preset.fallbackColor,
    });
  }
  return state;
}

/** Keeps the preset palette intact while optionally enabling edge overlay. */
export function partStyleOverride(
  preset: ModelPreset,
  partId: PartId,
  edges: boolean,
): { color: Color; edge?: true } {
  return {
    color: preset.partColors.get(partId) ?? preset.fallbackColor,
    ...(edges ? { edge: true } : {}),
  };
}
