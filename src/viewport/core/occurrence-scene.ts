import type { InteractionState } from "../../interaction/interaction";
import type { PartId } from "../../geometry/part";
import { withInteractionVisibility } from "../../interaction/state";
import {
  applyOccurrenceMutations,
  type PreparedOccurrenceUpdate,
} from "../../scene-runtime/occurrence-update";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import type { WebGpuRenderer } from "../../renderer/gpu-renderer";
import { originTriadScaleFromBounds } from "../bounds/origin-triad";
import type { PlacedBoundsIndex } from "../bounds/placed-index";
import type { ViewportResultsState } from "../results";
import { partRevisionResultState } from "../results/application";
import { prepareSceneResults } from "../results/scene-transition";
import type { SceneUpdateOutcome } from "../types";
import { reconcileInteractionState } from "../scene-reconciliation";
import type { ViewportVisibilityState } from "../visibility/state";

/** Applies direct part-placement changes through one prepared owner transaction. */
export function applySceneOccurrenceUpdate(options: {
  readonly renderer: WebGpuRenderer;
  readonly runtime: PackedSceneRuntime;
  readonly scene: Scene;
  readonly mutations: PreparedOccurrenceUpdate;
  readonly visibility: ViewportVisibilityState;
  readonly interaction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly placedBounds: PlacedBoundsIndex;
  readonly cancelCamera: () => void;
}): {
  readonly visibility: ViewportVisibilityState;
  readonly interaction: InteractionState;
  readonly renderInteraction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly outcome: SceneUpdateOutcome;
  readonly originTriadScale: number;
} {
  options.renderer.preparePartAdditions(options.scene.parts, options.mutations.addedPartIds);
  const transaction = options.runtime.beginHierarchyTransaction();
  let rendererUpdate: ReturnType<WebGpuRenderer["prepareOccurrenceUpdate"]> | undefined;
  let boundsUpdate: ReturnType<PlacedBoundsIndex["beginTransaction"]> | undefined;
  try {
    const delta = applyOccurrenceMutations(options.runtime, options.mutations);
    const visibility = options.visibility.reconcile(options.scene, options.runtime);
    const interaction = reconcileInteractionState(
      options.interaction,
      options.runtime,
      options.scene.parts,
    );
    const resultUpdate = prepareSceneResults(options.results, options.scene, options.runtime);
    const renderInteraction = withInteractionVisibility(
      interaction,
      visibility.interactionVisibility(),
    );
    rendererUpdate = prepareRendererUpdate(options, delta, renderInteraction, resultUpdate.results);
    boundsUpdate = prepareBoundsUpdate(options, delta);
    options.cancelCamera();
    options.renderer.commitOccurrenceUpdate(rendererUpdate);
    transaction.commit();
    boundsUpdate.commit();
    return {
      visibility,
      interaction,
      renderInteraction,
      results: resultUpdate.results,
      outcome: resultUpdate.outcome,
      originTriadScale: originTriadScaleFromBounds(options.placedBounds.bounds),
    };
  } catch (error) {
    if (rendererUpdate !== undefined) options.renderer.discardOccurrenceUpdate(rendererUpdate);
    boundsUpdate?.rollback();
    transaction.rollback();
    throw error;
  }
}

function prepareRendererUpdate(
  options: Parameters<typeof applySceneOccurrenceUpdate>[0],
  delta: ReturnType<typeof applyOccurrenceMutations>,
  interaction: InteractionState,
  results: ViewportResultsState | undefined,
): ReturnType<WebGpuRenderer["prepareOccurrenceUpdate"]> {
  return options.renderer.prepareOccurrenceUpdate({
    runtime: options.runtime,
    interaction,
    delta,
    parts: options.scene.parts,
    results: partRevisionResultState(results, options.runtime, delta.affectedPartIds),
    replacedPartIds: placedAddedPartIds(delta),
  });
}

function placedAddedPartIds(
  delta: ReturnType<typeof applyOccurrenceMutations>,
): ReadonlySet<PartId> {
  return new Set([...delta.addedPartIds].filter((partId) => delta.affectedPartIds.has(partId)));
}

function prepareBoundsUpdate(
  options: Parameters<typeof applySceneOccurrenceUpdate>[0],
  delta: ReturnType<typeof applyOccurrenceMutations>,
): ReturnType<PlacedBoundsIndex["beginTransaction"]> {
  const slots = delta.slots.map(({ slot }) => slot);
  const update = options.placedBounds.beginTransaction(slots, delta.addedPartIds);
  try {
    options.placedBounds.updateParts(options.scene.parts, delta.addedPartIds);
    options.placedBounds.update(options.runtime, slots);
    return update;
  } catch (error) {
    update.rollback();
    throw error;
  }
}
