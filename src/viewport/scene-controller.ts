import type { InteractionState } from "../interaction/interaction";
import { createInteractionState } from "../interaction/interaction";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../scene-runtime/runtime";
import { createSceneOccurrences, type SceneOccurrences } from "../scene-runtime/occurrences";
import { applyTransformPatch, prepareTransformPatch } from "../scene-runtime/transform-update";
import {
  applyOccurrenceMutations,
  prepareOccurrenceMutations,
} from "../scene-runtime/occurrence-update";
import {
  applyHierarchyMutations,
  prepareHierarchyMutations,
} from "../scene-runtime/hierarchy-update";
import type { Scene } from "../scene/scene";
import { prepareSceneTransition, type SceneUpdate } from "../scene/update";
import { hasOnlyPartReplacementChanges } from "../scene/update-validation";
import { originTriadScaleFromBounds } from "./bounds/origin-triad";
import { PlacedBoundsIndex } from "./bounds/placed-index";
import type { ViewportResultsConfig, ViewportResultsState } from "./results";
import {
  applyResolvedViewportResults,
  applyViewportResults,
  partRevisionResultState,
} from "./results/application";
import { reconcileInteractionState } from "./scene-reconciliation";
import { preparePartRevisionResults, prepareSceneResults } from "./results/scene-transition";
import { ViewportVisibilityState } from "./visibility/state";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { SceneUpdateOutcome } from "./types";
import {
  commitRendererOccurrenceUpdate,
  discardRendererOccurrenceUpdate,
  prepareRendererPartAdditions,
  prepareRendererOccurrenceUpdate,
  updateRendererOccurrences,
  updateRendererPartRevisions,
} from "../renderer/gpu-renderer";

interface PreparedSceneReplacement {
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly originTriadNominalScale: number;
  readonly placedBounds: PlacedBoundsIndex;
  readonly baseInteraction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly outcome: SceneUpdateOutcome;
  readonly visibility: ViewportVisibilityState;
}

interface SceneControllerOptions {
  readonly scene: Scene;
  readonly interaction: InteractionState | undefined;
  readonly renderer: WebGpuRenderer;
}

interface SceneUpdateResult {
  readonly committed: boolean;
  readonly outcome: SceneUpdateOutcome;
  readonly rendererSynchronized: boolean;
}

/** Owns the live scene, runtime, results, and interaction transaction state. */
export class ViewportSceneController {
  private currentScene: Scene;
  private currentRuntime: PackedSceneRuntime;
  private currentPublicRuntime: SceneOccurrences;
  private baseInteraction: InteractionState;
  private currentResults: ViewportResultsState | undefined;
  private originTriadNominalScale: number;
  private placedBounds: PlacedBoundsIndex;
  private currentVisibility: ViewportVisibilityState;
  private updateActive = false;

  constructor(private readonly options: SceneControllerOptions) {
    this.currentScene = options.scene;
    this.currentRuntime = createPackedSceneRuntime(options.scene);
    this.currentVisibility = ViewportVisibilityState.create(options.scene, this.currentRuntime);
    this.placedBounds = new PlacedBoundsIndex(options.scene, this.currentRuntime);
    this.originTriadNominalScale = originTriadScaleFromBounds(this.placedBounds.bounds);
    this.currentPublicRuntime = createSceneOccurrences(() => this.currentRuntime);
    this.baseInteraction = options.interaction ?? createInteractionState();
  }

  get scene(): Scene {
    return this.currentScene;
  }

  get runtime(): PackedSceneRuntime {
    return this.currentRuntime;
  }

  get publicRuntime(): SceneOccurrences {
    return this.currentPublicRuntime;
  }

  get interaction(): InteractionState {
    return this.baseInteraction;
  }

  get results(): ViewportResultsState | undefined {
    return this.currentResults;
  }

  get originTriadScale(): number {
    return this.originTriadNominalScale;
  }

  get visibility(): ViewportVisibilityState {
    return this.currentVisibility;
  }

  replaceScene(scene: Scene, cancelCamera: () => void): void {
    this.applySceneReplacement(scene, false, true, cancelCamera);
  }

  updateScene(
    operation: (update: SceneUpdate) => void,
    cancelCamera: () => void,
  ): SceneUpdateResult {
    if (this.updateActive) throw new Error("A scene update is already active");
    this.updateActive = true;
    let prepared: ReturnType<typeof prepareSceneTransition>;
    try {
      prepared = prepareSceneTransition(this.currentScene, operation);
    } finally {
      this.updateActive = false;
    }
    if (prepared === undefined) {
      const results = this.currentResults === undefined ? "none" : "preserved";
      return { committed: false, outcome: { results }, rendererSynchronized: true };
    }
    const transformPatch = prepareTransformPatch(
      this.currentRuntime,
      prepared.scene,
      prepared.changes,
    );
    if (transformPatch !== undefined) {
      return this.applyTransformUpdate(prepared.scene, transformPatch, cancelCamera);
    }
    const occurrenceMutations = prepareOccurrenceMutations(
      this.currentRuntime,
      prepared.scene,
      prepared.changes,
      (partId, authoredVisible) => this.currentVisibility.isPartVisible(partId, authoredVisible),
    );
    if (occurrenceMutations !== undefined) {
      return this.applyOccurrenceUpdate(prepared.scene, occurrenceMutations, cancelCamera);
    }
    const hierarchyMutations = prepareHierarchyMutations(
      this.currentRuntime,
      this.currentScene,
      prepared.scene,
      prepared.changes,
    );
    if (hierarchyMutations !== undefined) {
      return this.applyHierarchyUpdate(prepared.scene, hierarchyMutations, cancelCamera);
    }
    if (hasOnlyPartReplacementChanges(prepared.changes)) {
      return this.applyPartRevision(prepared.scene, prepared.changes.parts.replaced, cancelCamera);
    }
    return {
      committed: true,
      outcome: this.applySceneReplacement(prepared.scene, true, false, cancelCamera),
      rendererSynchronized: false,
    };
  }

  setInteraction(interaction: InteractionState): void {
    this.baseInteraction = interaction;
  }

  setResults(results: ViewportResultsConfig): void {
    this.currentResults = applyViewportResults({
      results,
      scene: this.currentScene,
      runtime: this.currentRuntime,
      renderer: this.options.renderer,
      ...(this.currentResults === undefined ? {} : { previous: this.currentResults }),
    });
  }

  clearResults(): void {
    this.currentResults = undefined;
    applyResolvedViewportResults(this.options.renderer, undefined);
  }

  private applyTransformUpdate(
    scene: Scene,
    patch: NonNullable<ReturnType<typeof prepareTransformPatch>>,
    cancelCamera: () => void,
  ): SceneUpdateResult {
    cancelCamera();
    const changedSlots = applyTransformPatch(this.currentRuntime, patch);
    this.options.renderer.updateInstances(this.currentRuntime, this.baseInteraction, changedSlots);
    this.currentScene = scene;
    this.placedBounds.update(this.currentRuntime, changedSlots);
    this.originTriadNominalScale = originTriadScaleFromBounds(this.placedBounds.bounds);
    return {
      committed: true,
      outcome: { results: this.currentResults === undefined ? "none" : "preserved" },
      rendererSynchronized: true,
    };
  }

  private applyOccurrenceUpdate(
    scene: Scene,
    mutations: NonNullable<ReturnType<typeof prepareOccurrenceMutations>>,
    cancelCamera: () => void,
  ): SceneUpdateResult {
    prepareRendererPartAdditions(this.options.renderer, scene.parts, mutations.addedPartIds);
    cancelCamera();
    const delta = applyOccurrenceMutations(this.currentRuntime, mutations);
    this.currentVisibility.prunePartOccurrences(delta.removedOccurrenceSlots);
    this.currentVisibility.pruneParts(delta.removedPartIds);
    this.currentVisibility.admitParts(scene, delta.addedPartIds);
    const nextInteraction = reconcileInteractionState(
      this.baseInteraction,
      this.currentRuntime,
      scene.parts,
    );
    const resultUpdate = prepareSceneResults(this.currentResults, scene, this.currentRuntime);
    updateRendererOccurrences(
      this.options.renderer,
      this.currentRuntime,
      nextInteraction,
      delta,
      scene.parts,
    );
    this.currentScene = scene;
    this.baseInteraction = nextInteraction;
    this.currentResults = resultUpdate.results;
    this.placedBounds.updateParts(scene.parts, delta.addedPartIds);
    this.placedBounds.update(
      this.currentRuntime,
      delta.slots.map(({ slot }) => slot),
    );
    this.originTriadNominalScale = originTriadScaleFromBounds(this.placedBounds.bounds);
    applyResolvedViewportResults(this.options.renderer, resultUpdate.results);
    return { committed: true, outcome: resultUpdate.outcome, rendererSynchronized: true };
  }

  private applyPartRevision(
    scene: Scene,
    partIds: ReadonlySet<number>,
    cancelCamera: () => void,
  ): SceneUpdateResult {
    const nextInteraction = reconcileInteractionState(
      this.baseInteraction,
      this.currentRuntime,
      scene.parts,
    );
    const resultUpdate = preparePartRevisionResults(
      this.currentResults,
      scene,
      this.currentRuntime,
      partIds,
    );
    updateRendererPartRevisions(this.options.renderer, {
      runtime: this.currentRuntime,
      interaction: nextInteraction,
      parts: scene.parts,
      partIds,
      results: partRevisionResultState(resultUpdate.results, this.currentRuntime, partIds),
    });
    cancelCamera();
    this.currentScene = scene;
    this.baseInteraction = nextInteraction;
    this.currentResults = resultUpdate.results;
    this.placedBounds.updateParts(scene.parts, partIds);
    const changedSlots: number[] = [];
    for (const partId of partIds) {
      for (const slot of this.currentRuntime.getPartInstanceSlots(partId)) changedSlots.push(slot);
    }
    this.placedBounds.update(this.currentRuntime, changedSlots);
    this.originTriadNominalScale = originTriadScaleFromBounds(this.placedBounds.bounds);
    return { committed: true, outcome: resultUpdate.outcome, rendererSynchronized: true };
  }

  private applyHierarchyUpdate(
    scene: Scene,
    mutations: NonNullable<ReturnType<typeof prepareHierarchyMutations>>,
    cancelCamera: () => void,
  ): SceneUpdateResult {
    prepareRendererPartAdditions(this.options.renderer, scene.parts, mutations.addedPartIds);
    const transaction = this.currentRuntime.beginHierarchyTransaction();
    let rendererUpdate: ReturnType<typeof prepareRendererOccurrenceUpdate> | undefined;
    let boundsUpdate: ReturnType<PlacedBoundsIndex["beginTransaction"]> | undefined;
    try {
      const delta = this.applyHierarchyMutations(scene, mutations);
      const nextVisibility = this.currentVisibility.reconcileHierarchy(
        scene,
        this.currentRuntime,
        delta.removedOccurrenceSlots,
        delta.removedAssemblyOccurrenceIds,
      );
      const nextInteraction = reconcileInteractionState(
        this.baseInteraction,
        this.currentRuntime,
        scene.parts,
      );
      const resultUpdate = prepareSceneResults(this.currentResults, scene, this.currentRuntime);
      rendererUpdate = prepareRendererOccurrenceUpdate(this.options.renderer, {
        runtime: this.currentRuntime,
        interaction: nextInteraction,
        delta,
        parts: scene.parts,
        results: partRevisionResultState(
          resultUpdate.results,
          this.currentRuntime,
          delta.affectedPartIds,
        ),
        replacedPartIds: mutations.replacedPartIds,
      });
      const revisedPartIds = new Set([...delta.addedPartIds, ...mutations.replacedPartIds]);
      boundsUpdate = this.placedBounds.beginTransaction(
        delta.slots.map(({ slot }) => slot),
        revisedPartIds,
      );
      cancelCamera();
      this.updateHierarchyBounds(scene, delta, revisedPartIds);
      commitRendererOccurrenceUpdate(this.options.renderer, rendererUpdate);
      transaction.commit();
      boundsUpdate.commit();
      this.currentScene = scene;
      this.currentVisibility = nextVisibility;
      this.baseInteraction = nextInteraction;
      this.currentResults = resultUpdate.results;
      return { committed: true, outcome: resultUpdate.outcome, rendererSynchronized: true };
    } catch (error) {
      if (rendererUpdate !== undefined) {
        discardRendererOccurrenceUpdate(this.options.renderer, rendererUpdate);
      }
      boundsUpdate?.rollback();
      transaction.rollback();
      throw error;
    }
  }

  private applyHierarchyMutations(
    scene: Scene,
    mutations: NonNullable<ReturnType<typeof prepareHierarchyMutations>>,
  ): ReturnType<typeof applyHierarchyMutations> {
    return applyHierarchyMutations(
      this.currentRuntime,
      scene,
      mutations,
      (partId, authoredVisible) => this.currentVisibility.isPartVisible(partId, authoredVisible),
      (assemblyId, authoredVisible) =>
        this.currentVisibility.isAssemblyVisible(assemblyId, authoredVisible),
    );
  }

  private updateHierarchyBounds(
    scene: Scene,
    delta: ReturnType<typeof applyHierarchyMutations>,
    revisedPartIds: ReadonlySet<number>,
  ): void {
    this.placedBounds.updateParts(scene.parts, revisedPartIds);
    this.placedBounds.update(
      this.currentRuntime,
      delta.slots.map(({ slot }) => slot),
    );
    this.originTriadNominalScale = originTriadScaleFromBounds(this.placedBounds.bounds);
  }

  private applySceneReplacement(
    scene: Scene,
    preserveResults: boolean,
    resetRenderer: boolean,
    cancelCamera: () => void,
  ): SceneUpdateOutcome {
    const replacement = this.prepareSceneReplacement(scene, preserveResults);
    if (resetRenderer) this.options.renderer.resetScene(replacement.scene.parts);
    cancelCamera();
    this.currentScene = replacement.scene;
    this.currentRuntime = replacement.runtime;
    this.placedBounds = replacement.placedBounds;
    this.originTriadNominalScale = replacement.originTriadNominalScale;
    this.currentResults = replacement.results;
    this.baseInteraction = replacement.baseInteraction;
    this.currentVisibility = replacement.visibility;
    applyResolvedViewportResults(this.options.renderer, replacement.results);
    return replacement.outcome;
  }

  private prepareSceneReplacement(
    scene: Scene,
    preserveResults: boolean,
  ): PreparedSceneReplacement {
    const nextRuntime = createPackedSceneRuntime(scene);
    const nextPlacedBounds = new PlacedBoundsIndex(scene, nextRuntime);
    const nextVisibility = this.currentVisibility.reconcile(scene, nextRuntime);
    const nextOriginTriadNominalScale = originTriadScaleFromBounds(nextPlacedBounds.bounds);
    const nextInteraction = reconcileInteractionState(
      this.baseInteraction,
      nextRuntime,
      scene.parts,
    );
    const resultUpdate = preserveResults
      ? prepareSceneResults(this.currentResults, scene, nextRuntime)
      : { results: undefined, outcome: { results: "none" as const } };
    return {
      scene,
      runtime: nextRuntime,
      placedBounds: nextPlacedBounds,
      originTriadNominalScale: nextOriginTriadNominalScale,
      baseInteraction: nextInteraction,
      results: resultUpdate.results,
      outcome: resultUpdate.outcome,
      visibility: nextVisibility,
    };
  }
}
