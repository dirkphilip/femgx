import type { ResultColorMap } from "../../results/colors";
import type { DeformationState } from "../../results/deform";
import type { OrientationGlyphState } from "../orientation-glyphs/orientation-glyph";

/** Renderer-private result roles staged with one compatible part revision. */
export interface PartRevisionResultState {
  readonly deformation: DeformationState | undefined;
  readonly colors: ResultColorMap | undefined;
  readonly glyphs: OrientationGlyphState | undefined;
}
