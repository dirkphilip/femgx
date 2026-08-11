import type { ElementId, NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import type { BodyId, FaceId, PartId } from "../geometry/part";
import type { Vec3 } from "../math/vec3";
import type { InstanceId } from "../scene/types";

/** The most-specific resolved face pick with renderer-independent data. */
export interface FacePickTarget {
  readonly kind: "face";
  readonly partId: PartId;
  readonly instanceId: InstanceId;
  readonly elementId: ElementId;
  /** Optional logical body owning the face's element. */
  readonly bodyId?: BodyId;
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
  /** Optional logical body owning the picked element. */
  readonly bodyId?: BodyId;
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
      /** Optional logical body owning the element. */
      readonly bodyId?: BodyId;
    }
  | FacePickTarget
  | NodePickTarget;
