import {
  createInteractionState,
  setPartOverride,
  type Color,
  type InteractionState,
  type PartId,
} from "../../src/index";
import type { ModelPreset } from "../fixture/presets";

/** Creates the deterministic palette state for one demo model preset. */
export function createPresetInteraction(
  preset: ModelPreset,
  edges = false,
  nodes = false,
): InteractionState {
  let state = createInteractionState();
  for (const partId of preset.scene.parts.keys()) {
    state = setPartOverride(state, partId, partStyleOverride(preset, partId, edges, nodes));
  }
  return state;
}

/** Keeps the preset palette intact while optionally enabling display overlays. */
export function partStyleOverride(
  preset: ModelPreset,
  partId: PartId,
  edges: boolean,
  nodes = false,
): { color: Color; opacity?: number; edge?: true; nodes?: true } {
  const opacity = preset.partOpacities?.get(partId);
  const part = preset.scene.parts.get(partId);
  return {
    color: preset.partColors.get(partId) ?? preset.fallbackColor,
    ...(opacity === undefined ? {} : { opacity }),
    ...(edges ? { edge: true } : {}),
    ...(nodes && part?.geometry.primitive !== "points" ? { nodes: true } : {}),
  };
}
