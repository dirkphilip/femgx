import type { PartId } from "../geometry/part";
import type { DeformationState } from "../results/deform";
import type {
  ElementFrameField,
  NodalLoadField,
  ScalarField,
  VectorField,
} from "../results/fields";
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
  /** Authored three-component displacement at every model node. */
  readonly field: VectorField<"nodal">;
  /** Presentation multiplier applied to the authored displacement vectors. */
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
  /** Authored scalar values at nodes or elements. */
  readonly field: ViewportResultField;
  /** Optional reusable part receiving this field; omit for scene-wide ids. */
  readonly partId?: PartId;
  /** Shared display range; omitted to derive a finite range from the field. */
  readonly range?: ValueRange;
  /** Color map used to turn scalar values into surface colors. */
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
  /** Authored three-component orientation vector for each element. */
  readonly field: VectorField<"elemental">;
  /** Optional reusable part owner; omitted fields apply to all rendered parts. */
  readonly partId?: PartId;
  /** Renderer-owned glyph shape. */
  readonly glyph: "arrow" | "axis";
  /** Interpret the vector as a directed axis or an unoriented normal. */
  readonly transform: "direction" | "normal";
  /** Positive element-relative glyph length multiplier. */
  readonly lengthScale?: number;
  /** Shaft width in CSS pixels; defaults to 2 and accepts 1 through 8. */
  readonly widthPixels?: number;
}

/** Configuration for the renderer-owned RGB triad of an authored element frame. */
export interface ViewportElementFrameConfig {
  /** Authored orthonormal X/Y/Z frame for each element. */
  readonly field: ElementFrameField;
  /** The frame presentation is always the RGB triad glyph. */
  readonly glyph: "triad";
  /** Positive element-relative triad length multiplier. */
  readonly lengthScale?: number;
  /** Shaft width in CSS pixels; defaults to 2 and accepts 1 through 8. */
  readonly widthPixels?: number;
}

/** Configuration for authored nodal forces and moments. */
export interface ViewportLoadConfig {
  /** Authored nodal force and moment values. */
  readonly field: NodalLoadField;
  /** Part-local length units rendered per authored force unit. */
  readonly forceLengthScale?: number;
  /** Part-local radius units rendered per authored moment unit. */
  readonly momentLengthScale?: number;
  /** Shaft width in CSS pixels; defaults to 2 and accepts 1 through 8. */
  readonly widthPixels?: number;
}

/**
 * One atomic, non-empty combination of authored result roles.
 *
 * Pass this object to {@link ViewportResults.set}. Scalar coloring,
 * deformation, and elemental orientation are validated together and installed
 * as one snapshot, so hosts do not expose a mixed state while sequencing their
 * own result cases. FemGx retains only the current snapshot.
 * @example Combine an authored scalar snapshot with nodal deformation.
 * ```ts
 * viewport.results.set({
 *   scalar: { field: temperature },
 *   deformation: { field: displacement, scale: 1.5 },
 * });
 * ```
 * @category Results
 */
export interface ViewportResultsConfig {
  /** Optional scalar coloring role. */
  readonly scalar?: ViewportScalarConfig;
  /** Optional nodal deformation role. */
  readonly deformation?: ViewportDeformationConfig;
  /** Optional authored elemental orientation role. */
  readonly orientation?: ViewportElementVectorConfig | ViewportElementFrameConfig;
  /** Optional authored nodal force and moment role. */
  readonly loads?: ViewportLoadConfig;
}

/**
 * Resolved scalar role installed on a viewport.
 * @category Results
 */
export interface ViewportScalarState {
  /** Original scalar-role configuration. */
  readonly config: ViewportScalarConfig;
  /** Validated scalar field installed for rendering. */
  readonly field: ViewportResultField;
  /** Effective range used by the color mapper. */
  readonly range: ValueRange;
  /** Effective color map used by the renderer. */
  readonly colorMap: ScalarColorMap;
}

/**
 * Resolved elemental vector role installed on a viewport.
 * @category Results
 */
export type ViewportOrientationState =
  | {
      /** Original vector-role configuration. */
      readonly config: ViewportElementVectorConfig;
      /** Validated authored elemental orientation. */
      readonly field: VectorField<"elemental">;
      /** Renderer-owned glyph shape. */
      readonly glyph: "arrow" | "axis";
      /** Direction or normal interpretation selected by the host. */
      readonly transform: "direction" | "normal";
      /** Resolved positive element-relative glyph length. */
      readonly lengthScale: number;
      /** Resolved shaft width in CSS pixels. */
      readonly widthPixels: number;
    }
  | {
      /** Original frame-role configuration. */
      readonly config: ViewportElementFrameConfig;
      /** Validated authored elemental frames. */
      readonly field: ElementFrameField;
      /** Renderer-owned RGB triad glyph. */
      readonly glyph: "triad";
      /** Frame axes use the directed-axis transform. */
      readonly transform: "direction";
      /** Resolved positive element-relative triad length. */
      readonly lengthScale: number;
      /** Resolved shaft width in CSS pixels. */
      readonly widthPixels: number;
    };

/**
 * Resolved authored result roles installed on a viewport.
 * @category Results
 */
export interface ViewportResultsState {
  /** Atomic configuration from the latest installed snapshot. */
  readonly config: ViewportResultsConfig;
  /** Resolved scalar role, when scalar coloring is active. */
  readonly scalar: ViewportScalarState | undefined;
  /** Resolved nodal deformation, when deformation is active. */
  readonly deformation: DeformationState | undefined;
  /** Resolved elemental orientation role, when active. */
  readonly orientation: ViewportOrientationState | undefined;
  /** Resolved authored loads, when active. */
  readonly loads?: ViewportLoadConfig;
}
