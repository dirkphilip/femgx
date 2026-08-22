import type { InteractionState } from "../interaction/interaction";
import { createInteractionState } from "../interaction/interaction";
import { withInteractionVisibility } from "../interaction/state";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../scene-runtime/runtime";
import { createSceneOccurrences, type SceneOccurrences } from "../scene-runtime/occurrences";
import { applyTransformPatch, prepareTransformPatch } from "../scene-runtime/transform-update";
import { prepareOccurrenceMutations } from "../scene-runtime/occurrence-update";
import { isHierarchyNoop, prepareHierarchyMutations } from "../scene-runtime/hierarchy-update";
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
import { preparePartRevisionResults } from "./results/scene-transition";
import { ViewportVisibilityState } from "./visibility/state";
import { prepareSceneReplacement } from "./core/scene-replacement";
import {
  applySceneHierarchyMutations,
  prepareHierarchyRendererUpdate,
  reconcileHierarchyState,
} from "./core/hierarchy-scene";
import { applySceneOccurrenceUpdate } from "./core/occurrence-scene";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { SceneUpdateOutcome } from "./types";

interface SceneControllerOptions {
  readonly scene: Scene;
  readonly interaction: InteractionState | undefined;
  readonly renderer: WebGpuRenderer;
}

interface SceneUpdateResult {
  readonly committed: boolean;
  readonly outcome: SceneUpdateOutcome;
  readonly rendererSynchronized: boolean;
  readonly requiresRender?: boolean;
}

/** Owns the live scene, runtime, results, and interaction transaction state. */
export class ViewportSceneController {
  private currentScene: Scene;
  private currentRuntime: PackedSceneRuntime;
  private currentPublicRuntime: SceneOccurrences;
  private baseInteraction: InteractionState;
  private renderInteraction: InteractionState;
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
    this.renderInteraction = withInteractionVisibility(
      this.baseInteraction,
      this.currentVisibility.interactionVisibility(),
    );
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

  get rendererInteraction(): InteractionState {
    return this.renderInteraction;
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
    if (this.baseInteraction === interaction) return;
    this.baseInteraction = interaction;
    this.refreshRendererInteraction();
  }

  markVisibilityChanged(): void {
    this.refreshRendererInteraction();
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
    this.options.renderer.updateInstances(
      this.currentRuntime,
      this.renderInteraction,
      changedSlots,
    );
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
    const update = applySceneOccurrenceUpdate({
      renderer: this.options.renderer,
      runtime: this.currentRuntime,
      scene,
      mutations,
      visibility: this.currentVisibility,
      interaction: this.baseInteraction,
      results: this.currentResults,
      placedBounds: this.placedBounds,
      cancelCamera,
    });
    this.currentVisibility = update.visibility;
    this.baseInteraction = update.interaction;
    this.renderInteraction = update.renderInteraction;
    this.currentResults = update.results;
    this.currentScene = scene;
    this.originTriadNominalScale = update.originTriadScale;
    return { committed: true, outcome: update.outcome, rendererSynchronized: true };
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
    this.currentVisibility.reconcilePrimitiveVisibility(scene, this.currentRuntime);
    const nextRenderInteraction = withInteractionVisibility(
      nextInteraction,
      this.currentVisibility.interactionVisibility(),
    );
    const resultUpdate = preparePartRevisionResults(
      this.currentResults,
      scene,
      this.currentRuntime,
      partIds,
    );
    this.options.renderer.updatePartRevisions(
      this.currentRuntime,
      nextRenderInteraction,
      scene.parts,
      partIds,
      partRevisionResultState(resultUpdate.results, this.currentRuntime, partIds),
    );
    cancelCamera();
    this.currentScene = scene;
    this.baseInteraction = nextInteraction;
    this.renderInteraction = nextRenderInteraction;
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
    if (isHierarchyNoop(mutations)) return this.applyUnplacedAssemblyDefinitionUpdate(scene);
    this.options.renderer.preparePartAdditions(scene.parts, mutations.addedPartIds);
    const transaction = this.currentRuntime.beginHierarchyTransaction();
    let rendererUpdate: ReturnType<WebGpuRenderer["prepareOccurrenceUpdate"]> | undefined;
    let boundsUpdate: ReturnType<PlacedBoundsIndex["beginTransaction"]> | undefined;
    try {
      const delta = applySceneHierarchyMutations({
        runtime: this.currentRuntime,
        scene,
        mutations,
        visibility: this.currentVisibility,
      });
      const { visibility: nextVisibility, interaction: nextInteraction } = reconcileHierarchyState({
        visibility: this.currentVisibility,
        interaction: this.baseInteraction,
        runtime: this.currentRuntime,
        scene,
        delta,
      });
      const prepared = prepareHierarchyRendererUpdate({
        renderer: this.options.renderer,
        runtime: this.currentRuntime,
        scene,
        mutations,
        delta,
        interaction: nextInteraction,
        visibility: nextVisibility,
        currentResults: this.currentResults,
      });
      rendererUpdate = prepared.rendererUpdate;
      const revisedPartIds = new Set([...delta.addedPartIds, ...mutations.replacedPartIds]);
      boundsUpdate = this.placedBounds.beginTransaction(
        delta.slots.map(({ slot }) => slot),
        revisedPartIds,
      );
      cancelCamera();
      this.updateHierarchyBounds(scene, delta, revisedPartIds);
      this.options.renderer.commitOccurrenceUpdate(rendererUpdate);
      transaction.commit();
      boundsUpdate.commit();
      this.currentScene = scene;
      this.currentVisibility = nextVisibility;
      this.baseInteraction = nextInteraction;
      this.renderInteraction = prepared.interaction;
      this.currentResults = prepared.results;
      return { committed: true, outcome: prepared.outcome, rendererSynchronized: true };
    } catch (error) {
      if (rendererUpdate !== undefined) {
        this.options.renderer.discardOccurrenceUpdate(rendererUpdate);
      }
      boundsUpdate?.rollback();
      transaction.rollback();
      throw error;
    }
  }

  private applyUnplacedAssemblyDefinitionUpdate(scene: Scene): SceneUpdateResult {
    this.currentScene = scene;
    this.currentVisibility = this.currentVisibility.reconcileUnplacedAssemblyDefinitions(scene);
    this.refreshRendererInteraction();
    return {
      committed: true,
      outcome: { results: this.currentResults === undefined ? "none" : "preserved" },
      rendererSynchronized: true,
      requiresRender: false,
    };
  }

  private updateHierarchyBounds(
    scene: Scene,
    delta: ReturnType<typeof applySceneHierarchyMutations>,
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
    const replacement = prepareSceneReplacement({
      scene,
      preserveResults,
      currentResults: this.currentResults,
      currentVisibility: this.currentVisibility,
      baseInteraction: this.baseInteraction,
    });
    if (resetRenderer) this.options.renderer.resetScene(replacement.scene.parts);
    cancelCamera();
    this.currentScene = replacement.scene;
    this.currentRuntime = replacement.runtime;
    this.placedBounds = replacement.placedBounds;
    this.originTriadNominalScale = replacement.originTriadNominalScale;
    this.currentResults = replacement.results;
    this.baseInteraction = replacement.baseInteraction;
    this.currentVisibility = replacement.visibility;
    this.refreshRendererInteraction();
    applyResolvedViewportResults(this.options.renderer, replacement.results);
    return replacement.outcome;
  }

  private refreshRendererInteraction(): void {
    this.renderInteraction = withInteractionVisibility(
      this.baseInteraction,
      this.currentVisibility.interactionVisibility(),
    );
  }
}
