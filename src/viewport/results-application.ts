import type { InteractionState } from "../interaction/interaction";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import {
  resolveViewportInteraction,
  resolveViewportResults,
  viewportResultColors,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";

/** Applies authored results to the renderer and returns the effective interaction state. */
export function applyViewportResults(
  results: ViewportResultsConfig,
  scene: Scene,
  runtime: PackedSceneRuntime,
  interaction: InteractionState,
  renderer: WebGpuRenderer,
): { readonly results: ViewportResultsState; readonly interaction: InteractionState } {
  const resolved = resolveViewportResults(results, scene, runtime);
  renderer.setDeformation(resolved.deformation);
  renderer.setResultColors(viewportResultColors(resolved));
  return {
    results: resolved,
    interaction: resolveViewportInteractionState(interaction, resolved, scene, runtime),
  };
}

/** Reconciles base interaction with the currently authored result presentation. */
export function resolveViewportInteractionState(
  interaction: InteractionState,
  results: ViewportResultsState | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
): InteractionState {
  return resolveViewportInteraction(interaction, results, scene, runtime);
}
