import {
  setRendererOrientationGlyphs,
  setRendererResultColors,
  type WebGpuRenderer,
} from "../renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import {
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
  readonly renderer: WebGpuRenderer;
  readonly previous?: ViewportResultsState;
}

/** Applies authored results to the renderer and returns the resolved result state. */
export function applyViewportResults(
  application: ViewportResultsApplication,
): ViewportResultsState {
  const resolved = resolveViewportResults(
    application.results,
    application.scene,
    application.runtime,
    application.previous,
  );
  applyResolvedViewportResults(application.renderer, resolved);
  return resolved;
}

/** Applies one resolved result state to all renderer-owned result roles. */
export function applyResolvedViewportResults(
  renderer: WebGpuRenderer,
  results: ViewportResultsState | undefined,
): void {
  const vectors = results?.vectors;
  const load = results?.loads;
  const widthPixels = Math.max(vectors?.widthPixels ?? 1, load?.widthPixels ?? 1);
  setRendererOrientationGlyphs(
    renderer,
    vectors === undefined && load === undefined
      ? undefined
      : {
          parts:
            results === undefined ? new Map() : (viewportOrientationRecords(results) ?? new Map()),
          mode: vectors === undefined || load !== undefined ? "arrow" : vectors.glyph,
          transform: vectors?.transform ?? "direction",
          lengthScale: 1,
          widthPixels,
        },
  );
  renderer.setDeformation(results?.deformation);
  setRendererResultColors(
    renderer,
    results === undefined ? undefined : viewportResultColors(results),
  );
}
