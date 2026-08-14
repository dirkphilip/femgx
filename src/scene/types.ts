import type { ElementId } from "../elements/element";
import type { PartId } from "../geometry/part";
import type { Mat4 } from "../math/mat4";

export type { ElementId } from "../elements/element";

/**
 * A globally stable identifier for an assembly within a scene.
 * @category Scene and geometry
 */
export type AssemblyId = number;

/**
 * Stable identity of a placement in an assembly tree.
 * @category Scene and geometry
 */
export type InstanceId = string;

/**
 * Stable identity of one expanded assembly occurrence in a scene runtime.
 * @category Scene and geometry
 */
export type AssemblyOccurrenceId = string;

/**
 * Stable identity of one element occurrence (an element placed in the scene).
 * @category Scene and geometry
 */
export interface ElementRef {
  /** The placement whose geometry contains the element. */
  readonly instanceId: InstanceId;
  /** The element id within that placement's part geometry. */
  readonly elementId: ElementId;
}

/**
 * A single placement of a part in the world, produced by flattening an
 * assembly tree. Instances are the unit of GPU instancing and picking.
 * @category Scene and geometry
 */
export interface Instance {
  /** Index into the current visible draw list; it may change after culling. */
  readonly index: number;
  /** Stable identity of the source placement, independent of visibility. */
  readonly instanceId: InstanceId;
  /** The part this instance draws. */
  readonly partId: PartId;
  /** World transform (column-major 4x4 matrix). */
  readonly worldTransform: Mat4;
}

export type { Mat4 } from "../math/mat4";
