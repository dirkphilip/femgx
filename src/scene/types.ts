import type { ElementId } from "../elements/element";
import type { PartId } from "../geometry/part";
import type { Mat4 } from "../math/mat4";

export type { ElementId } from "../elements/element";

/**
 * A globally stable identifier for an assembly within a scene.
 * @category Scene and geometry
 */
export type AssemblyId = number;

declare const occurrenceIdBrand: unique symbol;

/**
 * Stable identity of a placement in an assembly tree.
 *
 * This is a category-distinct string handle. It is intentionally distinct from
 * `AssemblyOccurrenceId` so the compiler catches a lookup against the wrong
 * hierarchy level without adding a runtime wrapper or validation cost.
 * @category Scene and geometry
 */
export type PartOccurrenceId = string & {
  /** Optional marker preserves literal-string authoring ergonomics. */
  readonly [occurrenceIdBrand]?: "PartOccurrenceId";
};

/**
 * Stable identity of one expanded assembly occurrence in a scene runtime.
 *
 * This is a category-distinct string handle. It is intentionally distinct from
 * `PartOccurrenceId` so the compiler catches a lookup against the wrong
 * hierarchy level without adding a runtime wrapper or validation cost.
 * @category Scene and geometry
 */
export type AssemblyOccurrenceId = string & {
  /** Optional marker preserves literal-string authoring ergonomics. */
  readonly [occurrenceIdBrand]?: "AssemblyOccurrenceId";
};

/**
 * Stable identity of one element occurrence (an element placed in the scene).
 * @category Scene and geometry
 */
export interface ElementRef {
  /** The placement whose geometry contains the element. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** The element id within that placement's part geometry. */
  readonly elementId: ElementId;
}

/**
 * A single placement of a part in the world, produced by flattening an
 * assembly tree. Part occurrences are the unit of placed-geometry identity
 * for interaction and picking; renderer instancing remains an internal detail.
 * @category Scene and geometry
 */
export interface PartOccurrence {
  /** Stable identity of the source placement, independent of visibility. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** The reusable part this occurrence draws. */
  readonly partId: PartId;
  /** World transform (column-major 4x4 matrix). */
  readonly worldTransform: Mat4;
}
