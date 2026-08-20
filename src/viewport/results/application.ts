import {
  setRendererOrientationGlyphs,
  setRendererPartRevisionResults,
  setRendererResultColors,
  type WebGpuRenderer,
} from "../../renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import {
  resolveViewportResults,
  viewportOrientationRecords,
  viewportOrientationWidth,
  viewportResultColors,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "../results";

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
  setRendererOrientationGlyphs(renderer, glyphState(results));
  renderer.setDeformation(results?.deformation);
  setRendererResultColors(
    renderer,
    results === undefined ? undefined : viewportResultColors(results),
  );
}

/** Applies compatible result data after a definition-only scene revision. */
export function applyResolvedPartRevisionResults(
  renderer: WebGpuRenderer,
  results: ViewportResultsState | undefined,
): void {
  setRendererPartRevisionResults(renderer, {
    deformation: results?.deformation,
    colors: results === undefined ? undefined : viewportResultColors(results),
    glyphs: glyphState(results),
  });
}

function glyphState(results: ViewportResultsState | undefined) {
  const orientation = results?.orientation;
  const load = results?.loads;
  const records = results === undefined ? undefined : viewportOrientationRecords(results);
  return records === undefined
    ? undefined
    : {
        parts: records,
        mode: orientation === undefined || load !== undefined ? "arrow" : orientation.glyph,
        transform: orientation?.transform ?? "direction",
        lengthScale: 1,
        widthPixels: results === undefined ? 1 : viewportOrientationWidth(results),
      };
}
