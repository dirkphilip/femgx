import type { ElementId, NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import type { BodyId, FaceId, PartId } from "../geometry/part";
import type { Vec3 } from "../math/vec3";
import type { InstanceId } from "../scene/types";

/** A selection granularity that a host may derive from a physical hit. */
export type InteractionGranularity = "part" | "instance" | "body" | "element" | "face" | "node";

/** The most-specific resolved face hit with renderer-independent data. */
export interface FacePickHit {
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
  /** Exact displayed world-space position under the pointer. */
  readonly worldPosition: Vec3;
  /** World-space oriented face normal. */
  readonly normal: Vec3;
}

/** The most-specific resolved node hit with renderer-independent data. */
export interface NodePickHit {
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

/** A physical hit reported by the GPU picking pass. */
export type PickHit =
  | {
      readonly kind: "part";
      readonly partId: PartId;
      readonly instanceId: InstanceId;
      readonly worldPosition: Vec3;
    }
  | {
      readonly kind: "instance";
      readonly partId: PartId;
      readonly instanceId: InstanceId;
      readonly worldPosition: Vec3;
    }
  | {
      readonly kind: "element";
      readonly partId: PartId;
      readonly instanceId: InstanceId;
      readonly elementId: ElementId;
      /** Optional logical body owning the element. */
      readonly bodyId?: BodyId;
      /** Exact displayed world-space position under the pointer. */
      readonly worldPosition: Vec3;
    }
  | FacePickHit
  | NodePickHit;
