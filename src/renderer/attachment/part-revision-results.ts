import type { ResultColorMap } from "../../results/colors";
import type { DeformationState } from "../../results/deform";
import type { OrientationGlyphState } from "../orientation-glyphs/orientation-glyph";

/** Renderer-private result roles staged with one compatible part revision. */
export interface PartRevisionResultState {
  readonly deformation: DeformationState | undefined;
  readonly colors: ResultColorMap | undefined;
  readonly glyphs: OrientationGlyphState | undefined;
  /** Exact revised bindings used while staging; retained state stays renderer-owned. */
  readonly staged: PartRevisionStagedResultState | undefined;
}

/** Renderer-private subset whose cost is bounded by revised occurrences. */
export interface PartRevisionStagedResultState {
  readonly deformation: DeformationState | undefined;
  readonly colors: ResultColorMap | undefined;
  readonly glyphs: OrientationGlyphState | undefined;
}
