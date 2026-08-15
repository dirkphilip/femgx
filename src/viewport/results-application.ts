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
  const vectors = resolved.vectors;
  setRendererOrientationGlyphs(
    application.renderer,
    vectors === undefined
      ? undefined
      : {
          parts: viewportOrientationRecords(resolved) ?? new Map(),
          mode: vectors.glyph,
          transform: vectors.transform,
          lengthScale: vectors.lengthScale,
          widthPixels: vectors.widthPixels,
        },
  );
  application.renderer.setDeformation(resolved.deformation);
  application.renderer.setResultColors(viewportResultColors(resolved));
  return {
    results: resolved,
    interaction,
  };
}
