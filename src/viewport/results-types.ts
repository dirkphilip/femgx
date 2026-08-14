import type { DeformationState } from "../results/deform";
import type { ScalarField, VectorField } from "../results/fields";
import type { ScalarColorMap } from "../results/mapping";
import type { ValueRange } from "../results/range";

/** An authored scalar field for viewport results. */
export type ViewportResultField = ScalarField<"nodal"> | ScalarField<"elemental">;

/** Optional nodal deformation attached to a result view. */
export interface ViewportDeformationConfig {
  readonly field: VectorField<"nodal">;
  readonly scale?: number;
}

/** Configuration for the optional authored scalar role. */
export interface ViewportScalarConfig {
  readonly field: ViewportResultField;
  readonly range?: ValueRange;
  readonly colorMap?: ScalarColorMap;
}

/** Configuration for the optional authored elemental vector role. */
export interface ViewportElementVectorConfig {
  readonly field: VectorField<"elemental">;
  readonly glyph: "arrow" | "axis";
  readonly transform: "direction" | "normal";
  readonly lengthScale?: number;
}

/** One atomic, non-empty combination of authored result roles. */
export interface ViewportResultsConfig {
  readonly scalar?: ViewportScalarConfig;
  readonly deformation?: ViewportDeformationConfig;
  readonly vectors?: ViewportElementVectorConfig;
}

/** Resolved scalar role installed on a viewport. */
export interface ViewportScalarState {
  readonly config: ViewportScalarConfig;
  readonly field: ViewportResultField;
  readonly range: ValueRange;
  readonly colorMap: ScalarColorMap;
}

/** Resolved elemental vector role installed on a viewport. */
export interface ViewportElementVectorState {
  readonly config: ViewportElementVectorConfig;
  readonly field: VectorField<"elemental">;
  readonly glyph: "arrow" | "axis";
  readonly transform: "direction" | "normal";
  readonly lengthScale: number;
}

/** Resolved authored result roles installed on a viewport. */
export interface ViewportResultsState {
  readonly config: ViewportResultsConfig;
  readonly scalar: ViewportScalarState | undefined;
  readonly deformation: DeformationState | undefined;
  readonly vectors: ViewportElementVectorState | undefined;
}
