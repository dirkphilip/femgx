import type { InteractionState } from "../../interaction/interaction";
import { reconcileInteractionState } from "../scene-reconciliation";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import type { SceneUpdateOutcome } from "../types";
import type { ViewportResultsState } from "../results";
import { prepareSceneResults } from "../results/scene-transition";
import { PlacedBoundsIndex } from "../bounds/placed-index";
import { originTriadScaleFromBounds } from "../bounds/origin-triad";
import type { ViewportVisibilityState } from "../visibility/state";

export interface PreparedSceneReplacement {
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly originTriadNominalScale: number;
  readonly placedBounds: PlacedBoundsIndex;
  readonly baseInteraction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly outcome: SceneUpdateOutcome;
  readonly visibility: ViewportVisibilityState;
}

/** Builds replacement scene state before the controller commits it. */
export function prepareSceneReplacement(options: {
  readonly scene: Scene;
  readonly preserveResults: boolean;
  readonly currentResults: ViewportResultsState | undefined;
  readonly currentVisibility: ViewportVisibilityState;
  readonly baseInteraction: InteractionState;
}): PreparedSceneReplacement {
  const runtime = createPackedSceneRuntime(options.scene);
  const placedBounds = new PlacedBoundsIndex(options.scene, runtime);
  const visibility = options.currentVisibility.reconcile(options.scene, runtime);
  const nextInteraction = reconcileInteractionState(
    options.baseInteraction,
    runtime,
    options.scene.parts,
  );
  const resultUpdate = options.preserveResults
    ? prepareSceneResults(options.currentResults, options.scene, runtime)
    : { results: undefined, outcome: { results: "none" as const } };
  return {
    scene: options.scene,
    runtime,
    placedBounds,
    originTriadNominalScale: originTriadScaleFromBounds(placedBounds.bounds),
    baseInteraction: nextInteraction,
    results: resultUpdate.results,
    outcome: resultUpdate.outcome,
    visibility,
  };
}
