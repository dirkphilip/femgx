import type { InteractionState } from "../interaction/interaction";
import { createInteractionState } from "../interaction/interaction";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../scene-runtime/runtime";
import { createPublicSceneRuntime, type SceneRuntime } from "../scene-runtime/public-runtime";
import type { Scene } from "../scene/scene";
import { sceneOriginTriadScale } from "./origin-triad";
import {
  resolveViewportResults,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";
import { applyResolvedViewportResults, applyViewportResults } from "./results-application";
import { preserveRuntimeVisibility, reconcileInteractionState } from "./scene-reconciliation";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { SceneUpdateOutcome } from "./types";

interface PreparedSceneReplacement {
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly publicRuntime: SceneRuntime;
  readonly originTriadNominalScale: number;
  readonly baseInteraction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly outcome: SceneUpdateOutcome;
}

interface SceneControllerOptions {
  readonly scene: Scene;
  readonly interaction: InteractionState | undefined;
  readonly renderer: WebGpuRenderer;
}

/** Owns the live scene, runtime, results, and interaction transaction state. */
export class ViewportSceneController {
  private currentScene: Scene;
  private currentRuntime: PackedSceneRuntime;
  private currentPublicRuntime: SceneRuntime;
  private baseInteraction: InteractionState;
  private currentResults: ViewportResultsState | undefined;
  private originTriadNominalScale: number;

  constructor(private readonly options: SceneControllerOptions) {
    this.currentScene = options.scene;
    this.currentRuntime = createPackedSceneRuntime(options.scene);
    this.originTriadNominalScale = sceneOriginTriadScale(options.scene, this.currentRuntime);
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

  setScene(scene: Scene, cancelCamera: () => void): void {
    this.replaceScene(scene, false, true, cancelCamera);
  }

  updateScene(scene: Scene, cancelCamera: () => void): SceneUpdateOutcome {
    return this.replaceScene(scene, true, false, cancelCamera);
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

  private replaceScene(
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
    this.originTriadNominalScale = replacement.originTriadNominalScale;
    this.currentPublicRuntime = replacement.publicRuntime;
    this.currentResults = replacement.results;
    this.baseInteraction = replacement.baseInteraction;
    applyResolvedViewportResults(this.options.renderer, replacement.results);
    return replacement.outcome;
  }

  private prepareSceneReplacement(
    scene: Scene,
    preserveResults: boolean,
  ): PreparedSceneReplacement {
    const nextRuntime = createPackedSceneRuntime(scene);
    preserveRuntimeVisibility(this.currentRuntime, nextRuntime);
    const nextOriginTriadNominalScale = sceneOriginTriadScale(scene, nextRuntime);
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
      publicRuntime: nextPublicRuntime,
      originTriadNominalScale: nextOriginTriadNominalScale,
      baseInteraction: nextInteraction,
      results: resultUpdate.results,
      outcome: resultUpdate.outcome,
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
