import type { InteractionState } from "../interaction/interaction";
import { setRendererOrientationGlyphs, type WebGpuRenderer } from "../renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import {
  resolveViewportInteraction,
  resolveViewportResults,
  viewportOrientationRecords,
  viewportResultColors,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";

interface ViewportResultsApplication {
  readonly results: ViewportResultsConfig;
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly renderer: WebGpuRenderer;
  readonly previous?: ViewportResultsState;
}

/** Applies authored results to the renderer and returns the effective interaction state. */
export function applyViewportResults(application: ViewportResultsApplication): {
  readonly results: ViewportResultsState;
  readonly interaction: InteractionState;
} {
  const resolved = resolveViewportResults(
    application.results,
    application.scene,
    application.runtime,
    application.previous,
  );
  const interaction = resolveViewportInteraction(
    application.interaction,
    resolved,
    application.scene,
    application.runtime,
  );
  applyResolvedViewportResults(application.renderer, resolved);
  return {
    results: resolved,
    interaction,
  };
}

/** Applies one resolved result state to all renderer-owned result roles. */
export function applyResolvedViewportResults(
  renderer: WebGpuRenderer,
  results: ViewportResultsState | undefined,
): void {
  const vectors = results?.vectors;
  setRendererOrientationGlyphs(
    renderer,
    vectors === undefined
      ? undefined
      : {
          parts:
            results === undefined ? new Map() : (viewportOrientationRecords(results) ?? new Map()),
          mode: vectors.glyph,
          transform: vectors.transform,
          lengthScale: vectors.lengthScale,
          widthPixels: vectors.widthPixels,
        },
  );
  renderer.setDeformation(results?.deformation);
  renderer.setResultColors(results === undefined ? undefined : viewportResultColors(results));
}
