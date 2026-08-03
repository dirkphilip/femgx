import type { Mat4 } from "./mat4";

/** A globally stable identifier for a part within a scene. */
export type PartId = number;

/** A globally stable identifier for an assembly within a scene. */
export type AssemblyId = number;

/**
 * A single placement of a part in the world, produced by flattening an
 * assembly tree. Instances are the unit of GPU instancing and picking.
 */
export interface Instance {
  /** Stable index into the flattened instance list; also the GPU pick id. */
  readonly index: number;
  /** The part this instance draws. */
  readonly partId: PartId;
  /** World transform (column-major 4x4 matrix). */
  readonly worldTransform: Mat4;
}

/** A resolveable reference to something the user can highlight/select. */
export type PickTarget =
  | { readonly kind: "part"; readonly partId: PartId }
  | { readonly kind: "instance"; readonly instanceIndex: number };

export type { Mat4 } from "./mat4";
