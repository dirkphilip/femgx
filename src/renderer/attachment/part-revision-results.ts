import type { ResultColorMap } from "../../results/colors";
import type { DeformationState } from "../../results/deform";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { syncDeformations, validateDeformation } from "../frame/deformation";
import {
  syncOrientationGlyphs,
  type OrientationGlyphState,
} from "../orientation-glyphs/orientation-glyph";
import type { DrawResources } from "../resources/draw-resources";
import { syncResultColors } from "../resources/result-colors";
import type { InstanceLayout } from "../runtime-state";

/** Renderer-private result roles that can be synchronized after a compatible part revision. */
export interface PartRevisionResultState {
  readonly deformation: DeformationState | undefined;
  readonly colors: ResultColorMap | undefined;
  readonly glyphs: OrientationGlyphState | undefined;
}

interface PartRevisionResultHost {
  readonly runtime: PackedSceneRuntime | undefined;
  readonly layout: InstanceLayout | undefined;
  readonly draw: DrawResources;
  clearResults(): void;
  installResults(results: PartRevisionResultState): void;
  installGlyphs(glyphs: OrientationGlyphState | undefined): void;
}

/** Keeps the established immediate glyph upload behavior for direct renderer updates. */
export function syncRendererOrientationGlyphs(
  draw: DrawResources,
  state: OrientationGlyphState | undefined,
  runtime: PackedSceneRuntime | undefined,
  layout: InstanceLayout | undefined,
): void {
  if (runtime !== undefined && layout !== undefined) {
    syncOrientationGlyphs(draw.orientationGlyphs, state, runtime, layout);
  }
}

/** Writes revised result roles without invalidating section-cap fragments retained by the caller. */
export function syncPartRevisionResults(
  host: PartRevisionResultHost,
  results: PartRevisionResultState,
): void {
  if (
    results.deformation === undefined &&
    results.colors === undefined &&
    results.glyphs === undefined
  ) {
    host.clearResults();
    return;
  }
  if (results.deformation !== undefined) validateDeformation(results.deformation);
  host.installGlyphs(results.glyphs);
  host.installResults(results);
  if (host.runtime === undefined || host.layout === undefined) return;
  syncDeformations(host.draw, results.deformation, host.runtime, host.layout);
  syncResultColors(host.draw, results.colors, host.runtime, host.layout);
}
