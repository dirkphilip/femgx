import type { WebGpuRenderer } from "../../renderer/gpu-renderer";
import type { PartRevisionResultState, RendererResultSnapshot } from "../../renderer/gpu-renderer";
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

/** Publishes one resolved result snapshot to the renderer. */
export function applyResolvedViewportResults(
  renderer: WebGpuRenderer,
  results: ViewportResultsState | undefined,
): void {
  renderer.setResultSnapshot(rendererResultSnapshot(results));
}

/** Converts resolved viewport results to the renderer-private revision transaction input. */
export function partRevisionResultState(
  results: ViewportResultsState | undefined,
  runtime: PackedSceneRuntime,
  partIds: ReadonlySet<PartId>,
): PartRevisionResultState {
  const snapshot = rendererResultSnapshot(results);
  const base =
    snapshot ??
    ({
      deformation: undefined,
      colors: undefined,
      glyphs: undefined,
    } satisfies RendererResultSnapshot);
  return {
    ...base,
    staged: snapshot === undefined ? undefined : revisedResultState(base, runtime, partIds),
  };
}

function revisedResultState(
  snapshot: RendererResultSnapshot,
  runtime: PackedSceneRuntime,
  partIds: ReadonlySet<PartId>,
) {
  const bindings = revisedResultBindings(createResultResolutionView(runtime), partIds);
  return {
    deformation:
      snapshot.deformation === undefined
        ? undefined
        : {
            ...snapshot.deformation,
            displacements: revisedBindings(snapshot.deformation.displacements, bindings),
          },
    colors: snapshot.colors === undefined ? undefined : revisedBindings(snapshot.colors, bindings),
    glyphs:
      snapshot.glyphs === undefined
        ? undefined
        : { ...snapshot.glyphs, parts: revisedBindings(snapshot.glyphs.parts, bindings) },
  };
}

function rendererResultSnapshot(
  results: ViewportResultsState | undefined,
): RendererResultSnapshot | undefined {
  if (results === undefined) return undefined;
  return {
    deformation: results.deformation,
    colors: viewportResultColors(results),
    glyphs: glyphState(results),
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
