import type { DeformationState } from "../results/deform";
import type { ScalarField, VectorField } from "../results/fields";
import type { ScalarColorMap } from "../results/mapping";
import type { ValueRange } from "../results/range";

/**
 * An authored scalar field for viewport results.
 * @category Results
 */
export type ViewportResultField = ScalarField<"nodal"> | ScalarField<"elemental">;

/**
 * Optional authored nodal deformation attached to a result view.
 *
 * The field must contain three components per node. `scale` is a finite host
 * presentation scale; femgx does not derive displacements or convert units.
 * @category Results
 */
export interface ViewportDeformationConfig {
  readonly field: VectorField<"nodal">;
  readonly scale?: number;
}

/**
 * Configuration for the optional authored scalar role.
 *
 * Nodal scalars are interpolated across existing tessellation; elemental
 * scalars are applied by authored element id. `range` and `colorMap` are
 * presentation choices, not solver metadata. Omit the range for an automatic
 * finite range, or provide one shared range when comparing host-owned
 * snapshots.
 * @category Results
 */
export interface ViewportScalarConfig {
  readonly field: ViewportResultField;
  readonly range?: ValueRange;
  readonly colorMap?: ScalarColorMap;
}

/**
 * Configuration for the optional authored elemental vector role.
 *
 * This bounded role accepts one authored three-component vector per element and
 * renders an `arrow` or `axis` using either `direction` or `normal` semantics.
 * It does not derive engineering quantities, magnitudes, or tensor glyphs.
 * @category Results
 */
export interface ViewportElementVectorConfig {
  readonly field: VectorField<"elemental">;
  readonly glyph: "arrow" | "axis";
  readonly transform: "direction" | "normal";
  readonly lengthScale?: number;
  /** Shaft width in CSS pixels; defaults to 2 and accepts 1 through 8. */
  readonly widthPixels?: number;
}

/**
 * One atomic, non-empty combination of authored result roles.
 *
 * Pass this object to {@link Viewport.setResults}. Scalar coloring,
 * deformation, and elemental orientation are validated together and installed
 * as one snapshot, so hosts do not expose a mixed state while sequencing their
 * own result cases. FemGx retains only the current snapshot.
 * @example Combine an authored scalar snapshot with nodal deformation.
 * ```ts
 * viewport.setResults({
 *   scalar: { field: temperature },
 *   deformation: { field: displacement, scale: 1.5 },
 * });
 * ```
 * @category Results
 */
export interface ViewportResultsConfig {
  readonly scalar?: ViewportScalarConfig;
  readonly deformation?: ViewportDeformationConfig;
  readonly vectors?: ViewportElementVectorConfig;
}

/**
 * Resolved scalar role installed on a viewport.
 * @category Results
 */
export interface ViewportScalarState {
  readonly config: ViewportScalarConfig;
  readonly field: ViewportResultField;
  readonly range: ValueRange;
  readonly colorMap: ScalarColorMap;
}

/**
 * Resolved elemental vector role installed on a viewport.
 * @category Results
 */
export interface ViewportElementVectorState {
  readonly config: ViewportElementVectorConfig;
  readonly field: VectorField<"elemental">;
  readonly glyph: "arrow" | "axis";
  readonly transform: "direction" | "normal";
  readonly lengthScale: number;
  readonly widthPixels: number;
}

/**
 * Resolved authored result roles installed on a viewport.
 * @category Results
 */
export interface ViewportResultsState {
  readonly config: ViewportResultsConfig;
  readonly scalar: ViewportScalarState | undefined;
  readonly deformation: DeformationState | undefined;
  readonly vectors: ViewportElementVectorState | undefined;
}
