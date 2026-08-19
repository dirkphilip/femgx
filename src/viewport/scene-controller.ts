import type { InteractionState } from "../interaction/interaction";
import { createInteractionState } from "../interaction/interaction";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../scene-runtime/runtime";
import { createPublicSceneRuntime, type SceneRuntime } from "../scene-runtime/public-runtime";
import { applyTransformPatch, prepareTransformPatch } from "../scene-runtime/transform-update";
import {
  applyOccurrenceMutations,
  prepareOccurrenceMutations,
} from "../scene-runtime/occurrence-update";
import type { Scene } from "../scene/scene";
import { prepareSceneTransition, type SceneUpdate } from "../scene/update";
import { originTriadScaleFromBounds } from "./bounds/origin-triad";
import { PlacedBoundsIndex } from "./bounds/placed-index";
import {
  resolveViewportResults,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";
import { applyResolvedViewportResults, applyViewportResults } from "./results-application";
import { reconcileInteractionState } from "./scene-reconciliation";
import { ViewportVisibilityState } from "./visibility-state";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { SceneUpdateOutcome } from "./types";
import { updateRendererOccurrences } from "../renderer/gpu-renderer";

interface PreparedSceneReplacement {
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly publicRuntime: SceneRuntime;
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
  private currentPublicRuntime: SceneRuntime;
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
    this.currentPublicRuntime = createPublicSceneRuntime(this.currentRuntime);
    this.baseInteraction = options.interaction ?? createInteractionState();
  }

  get scene(): Scene {
    return this.currentScene;
  }

  get runtime(): PackedSceneRuntime {
    return this.currentRuntime;
  }

  get publicRuntime(): SceneRuntime {
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
    cancelCamera();
    const delta = applyOccurrenceMutations(this.currentRuntime, mutations);
    this.currentVisibility.prunePartOccurrences(delta.removedOccurrenceSlots);
    const nextInteraction = reconcileInteractionState(
      this.baseInteraction,
      this.currentRuntime,
      scene.parts,
    );
    const resultUpdate = this.prepareSceneResults(scene, this.currentRuntime);
    updateRendererOccurrences(this.options.renderer, this.currentRuntime, nextInteraction, delta);
    this.currentScene = scene;
    this.baseInteraction = nextInteraction;
    this.currentResults = resultUpdate.results;
    this.placedBounds.update(
      this.currentRuntime,
      delta.slots.map(({ slot }) => slot),
    );
    this.originTriadNominalScale = originTriadScaleFromBounds(this.placedBounds.bounds);
    applyResolvedViewportResults(this.options.renderer, resultUpdate.results);
    return { committed: true, outcome: resultUpdate.outcome, rendererSynchronized: true };
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
    this.currentPublicRuntime = replacement.publicRuntime;
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
    const nextPublicRuntime = createPublicSceneRuntime(nextRuntime);
    const nextInteraction = reconcileInteractionState(
      this.baseInteraction,
      nextRuntime,
      scene.parts,
    );
    const resultUpdate = preserveResults
      ? this.prepareSceneResults(scene, nextRuntime)
      : { results: undefined, outcome: { results: "none" as const } };
    return {
      scene,
      runtime: nextRuntime,
      placedBounds: nextPlacedBounds,
      publicRuntime: nextPublicRuntime,
      originTriadNominalScale: nextOriginTriadNominalScale,
      baseInteraction: nextInteraction,
      results: resultUpdate.results,
      outcome: resultUpdate.outcome,
      visibility: nextVisibility,
    };
  }

  private prepareSceneResults(
    scene: Scene,
    runtime: PackedSceneRuntime,
  ): {
    readonly results: ViewportResultsState | undefined;
    readonly outcome: SceneUpdateOutcome;
  } {
    const previous = this.currentResults;
    if (previous === undefined) {
      return { results: undefined, outcome: { results: "none" } };
    }
    try {
      const results = resolveViewportResults(previous.config, scene, runtime, previous);
      return {
        results,
        outcome: { results: "preserved" },
      };
    } catch (error: unknown) {
      return {
        results: undefined,
        outcome: { results: "cleared", reason: errorMessage(error) },
      };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
