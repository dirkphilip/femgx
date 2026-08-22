import type { Scene } from "../../scene/scene";
import {
  applyHierarchyMutations,
  type PreparedHierarchyUpdate,
} from "../../scene-runtime/hierarchy-update";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { InteractionState } from "../../interaction/interaction";
import type { ViewportVisibilityState } from "../visibility/state";
import { reconcileInteractionState } from "../scene-reconciliation";
import { withInteractionVisibility } from "../../interaction/state";
import type { WebGpuRenderer } from "../../renderer/gpu-renderer";
import { prepareRendererOccurrenceUpdate } from "../../renderer/gpu-renderer";
import { prepareSceneResults } from "../results/scene-transition";
import { partRevisionResultState } from "../results/application";
import type { ViewportResultsState } from "../results";

/** Applies a prepared hierarchy update with the retained viewport policies. */
export function applySceneHierarchyMutations(options: {
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly mutations: PreparedHierarchyUpdate;
  readonly visibility: ViewportVisibilityState;
}): ReturnType<typeof applyHierarchyMutations> {
  return applyHierarchyMutations(
    options.runtime,
    options.scene,
    options.mutations,
    (partId, authoredVisible) => options.visibility.isPartVisible(partId, authoredVisible),
    (assemblyId, authoredVisible) =>
      options.visibility.isAssemblyVisible(assemblyId, authoredVisible),
  );
}

/** Reconciles visibility and interaction tokens after hierarchy mutation. */
export function reconcileHierarchyState(options: {
  readonly visibility: ViewportVisibilityState;
  readonly interaction: InteractionState;
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly delta: ReturnType<typeof applyHierarchyMutations>;
}): {
  readonly visibility: ViewportVisibilityState;
  readonly interaction: InteractionState;
} {
  const visibility = options.visibility.reconcileHierarchy(
    options.scene,
    options.runtime,
    options.delta.removedOccurrenceSlots,
    options.delta.removedAssemblyOccurrenceIds,
  );
  return {
    visibility,
    interaction: reconcileInteractionState(
      options.interaction,
      options.runtime,
      options.scene.parts,
    ),
  };
}

/** Prepares renderer and result state for a committed hierarchy delta. */
export function prepareHierarchyRendererUpdate(options: {
  readonly renderer: WebGpuRenderer;
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly mutations: PreparedHierarchyUpdate;
  readonly delta: ReturnType<typeof applyHierarchyMutations>;
  readonly interaction: InteractionState;
  readonly visibility: ViewportVisibilityState;
  readonly currentResults: ViewportResultsState | undefined;
}): {
  readonly rendererUpdate: ReturnType<typeof prepareRendererOccurrenceUpdate>;
  readonly interaction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly outcome: ReturnType<typeof prepareSceneResults>["outcome"];
} {
  const interaction = withInteractionVisibility(
    options.interaction,
    options.visibility.interactionVisibility(),
  );
  const resultUpdate = prepareSceneResults(options.currentResults, options.scene, options.runtime);
  return {
    rendererUpdate: prepareRendererOccurrenceUpdate(options.renderer, {
      runtime: options.runtime,
      interaction,
      delta: options.delta,
      parts: options.scene.parts,
      results: partRevisionResultState(
        resultUpdate.results,
        options.runtime,
        options.delta.affectedPartIds,
      ),
      replacedPartIds: options.mutations.replacedPartIds,
    }),
    interaction,
    results: resultUpdate.results,
    outcome: resultUpdate.outcome,
  };
}
