import type { Vec3 } from "../camera/camera";
import type { FaceKey } from "../elements/faces";
import type { ElementId, NodeId } from "../elements/element";
import type { FaceId } from "../geometry/part";
import type { Mat4 } from "../math/mat4";

export type { ElementId } from "../elements/element";

/** A globally stable identifier for a part within a scene. */
export type PartId = number;

/** A globally stable identifier for an assembly within a scene. */
export type AssemblyId = number;

/** Stable identity of a placement in an assembly tree. */
export type InstanceId = string;

/** Stable identity of one element occurrence (an element placed in the scene). */
export interface ElementRef {
  /** The placement whose geometry contains the element. */
  readonly instanceId: InstanceId;
  /** The element id within that placement's part geometry. */
  readonly elementId: ElementId;
}

/**
 * A single placement of a part in the world, produced by flattening an
 * assembly tree. Instances are the unit of GPU instancing and picking.
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

/** The most-specific resolved face pick with renderer-independent data. */
export interface FacePickTarget {
  readonly kind: "face";
  readonly partId: PartId;
  readonly instanceId: InstanceId;
  readonly elementId: ElementId;
  /** Stable part-local face id (index into the part's face descriptors). */
  readonly faceId: FaceId;
  readonly faceIndex: number;
  /** Canonical identity shared by coincident faces. */
  readonly key: FaceKey;
  /** Outward-oriented node loop of the face. */
  readonly nodeIds: readonly NodeId[];
  /** Other elements incident to the same canonical face. */
  readonly neighborElementIds: readonly ElementId[];
  /** World-space hit position (the face centroid for rasterized picks). */
  readonly hitPosition: Vec3;
  /** World-space oriented face normal. */
  readonly normal: Vec3;
}

/** The most-specific resolved node pick with renderer-independent data. */
export interface NodePickTarget {
  readonly kind: "node";
  readonly partId: PartId;
  readonly instanceId: InstanceId;
  /** The element whose tessellation was hit (the node's owning element here). */
  readonly elementId: ElementId;
  readonly nodeId: NodeId;
  readonly localPosition: Vec3;
  readonly worldPosition: Vec3;
  /** Elements whose faces reference this node. */
  readonly neighborElementIds: readonly ElementId[];
  /** Nodes sharing an element edge with this node. */
  readonly neighborNodeIds: readonly NodeId[];
}

/** A resolveable reference to something the user can highlight/select. */
export type PickTarget =
  | { readonly kind: "part"; readonly partId: PartId }
  | { readonly kind: "instance"; readonly instanceId: InstanceId }
  | {
      readonly kind: "element";
      readonly partId: PartId;
      readonly instanceId: InstanceId;
      readonly elementId: ElementId;
    }
  | FacePickTarget
  | NodePickTarget;

export type { Mat4 } from "../math/mat4";
