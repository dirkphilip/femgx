import {
  setRendererOrientationGlyphs,
  setRendererResultColors,
  type WebGpuRenderer,
} from "../../renderer/gpu-renderer";
import type { PartRevisionResultState } from "../../renderer/gpu-renderer";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PartId } from "../../geometry/part";
import type { Scene } from "../../scene/scene";
import {
  resolveViewportResults,
  viewportOrientationRecords,
  viewportOrientationWidth,
  viewportResultColors,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "../results";
import { revisedResultBindings } from "./revision-bindings";
import { createResultResolutionView } from "./resolution-view";

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

/** Converts resolved viewport results to the renderer-private revision transaction input. */
export function partRevisionResultState(
  results: ViewportResultsState | undefined,
  runtime: PackedSceneRuntime,
  partIds: ReadonlySet<PartId>,
): PartRevisionResultState {
  const colors = results === undefined ? undefined : viewportResultColors(results);
  const glyphs = glyphState(results);
  return {
    deformation: results?.deformation,
    colors,
    glyphs,
    staged:
      results === undefined
        ? undefined
        : revisedResultState(results.deformation, colors, glyphs, runtime, partIds),
  };
}

function revisedResultState(
  deformation: ViewportResultsState["deformation"],
  colors: ReturnType<typeof viewportResultColors>,
  glyphs: ReturnType<typeof glyphState>,
  runtime: PackedSceneRuntime,
  partIds: ReadonlySet<PartId>,
) {
  const bindings = revisedResultBindings(createResultResolutionView(runtime), partIds);
  return {
    deformation:
      deformation === undefined
        ? undefined
        : { ...deformation, displacements: revisedBindings(deformation.displacements, bindings) },
    colors: colors === undefined ? undefined : revisedBindings(colors, bindings),
    glyphs:
      glyphs === undefined
        ? undefined
        : { ...glyphs, parts: revisedBindings(glyphs.parts, bindings) },
  };
}

function revisedBindings<K, V>(
  source: ReadonlyMap<K, V>,
  bindings: ReadonlySet<K>,
): ReadonlyMap<K, V> {
  const revised = new Map<K, V>();
  for (const binding of bindings) {
    const value = source.get(binding);
    if (value !== undefined) revised.set(binding, value);
  }
  return revised;
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
