import type { ResultColorMap } from "../../results/colors";
import type { DeformationState } from "../../results/deform";
import type { OrientationGlyphState } from "../orientation-glyphs/orientation-glyph";

/** Renderer-owned immutable result roles displayed by every render path. */
export interface RendererResultSnapshot {
  readonly deformation: DeformationState | undefined;
  readonly colors: ResultColorMap | undefined;
  readonly glyphs: OrientationGlyphState | undefined;
}

/** Renderer-private result roles staged with one compatible part revision. */
export interface PartRevisionResultState extends RendererResultSnapshot {
  /** Exact revised bindings used while staging; retained state stays renderer-owned. */
  readonly staged: PartRevisionStagedResultState | undefined;
}

/** Renderer-private subset whose cost is bounded by revised occurrences. */
export interface PartRevisionStagedResultState {
  readonly deformation: DeformationState | undefined;
  readonly colors: ResultColorMap | undefined;
  readonly glyphs: OrientationGlyphState | undefined;
}
