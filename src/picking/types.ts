import type { ElementId, NodeId } from "../elements/element";
import type { EdgeKey } from "../elements/edges";
import type { FaceIdRef } from "../elements/faces";
import type { FaceKey } from "../elements/faces";
import type { BodyId, PartId } from "../geometry/part";
import type { Vec3 } from "../math/vec3";
import type { InstanceId } from "../scene/types";

/**
 * A selection granularity that a host may derive from a physical hit.
 * @category Interaction and picking
 */
export type InteractionGranularity =
  "part" | "instance" | "body" | "element" | "face" | "node" | "edge";

/**
 * The most-specific resolved face hit with renderer-independent data.
 * @category Interaction and picking
 */
export interface FacePickHit {
  /** Face-hit discriminator. */
  readonly kind: "face";
  /** Reusable part containing the hit. */
  readonly partId: PartId;
  /** Expanded placed-part instance containing the hit. */
  readonly instanceId: InstanceId;
  /** Authored element owning the face. */
  readonly elementId: ElementId;
  /** Optional logical body owning the face's element. */
  readonly bodyId?: BodyId;
  /** Zero-based canonical face index. */
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

/**
 * The most-specific resolved node hit with renderer-independent data.
 * @category Interaction and picking
 */
export interface NodePickHit {
  /** Node-hit discriminator. */
  readonly kind: "node";
  /** Reusable part containing the node. */
  readonly partId: PartId;
  /** Expanded placed-part instance containing the node. */
  readonly instanceId: InstanceId;
  /** The element whose tessellation was hit, when the node has one. */
  readonly elementId?: ElementId;
  /** Authored node identifier. */
  readonly nodeId: NodeId;
  /** Optional logical body owning the picked element. */
  readonly bodyId?: BodyId;
  /** Part-local node position. */
  readonly localPosition: Vec3;
  /** World-space node position after occurrence transform and deformation. */
  readonly worldPosition: Vec3;
  /** Elements whose faces reference this node. */
  readonly neighborElementIds: readonly ElementId[];
  /** Nodes sharing an element edge with this node. */
  readonly neighborNodeIds: readonly NodeId[];
}

/** The most-specific resolved authored-edge hit with stable topology data. */
export interface EdgePickHit {
  /** Authored-edge hit discriminator. */
  readonly kind: "edge";
  /** Reusable part containing the edge. */
  readonly partId: PartId;
  /** Expanded placed-part instance containing the edge. */
  readonly instanceId: InstanceId;
  /** Canonical authored edge key. */
  readonly key: EdgeKey;
  /** Ordered authored nodes making up the edge. */
  readonly nodeIds: readonly NodeId[];
  /** Elements incident to the edge. */
  readonly incidentElementIds: readonly ElementId[];
  /** Oriented faces containing the edge. */
  readonly faceRefs: readonly FaceIdRef[];
  /** World-space position under the pointer. */
  readonly worldPosition: Vec3;
  /** Unit world-space tangent oriented by the canonical node sequence. */
  readonly tangent: Vec3;
}

/**
 * A physical hit reported by the GPU picking pass.
 * @category Interaction and picking
 */
export type PickHit =
  | {
      /** Placed-instance hit discriminator. */
      readonly kind: "instance";
      /** Reusable part containing the instance. */
      readonly partId: PartId;
      /** Expanded placed-part instance identifier. */
      readonly instanceId: InstanceId;
      /** World-space position under the pointer. */
      readonly worldPosition: Vec3;
    }
  | {
      /** Element hit discriminator. */
      readonly kind: "element";
      /** Reusable part containing the element. */
      readonly partId: PartId;
      /** Expanded placed-part instance identifier. */
      readonly instanceId: InstanceId;
      /** Authored element identifier. */
      readonly elementId: ElementId;
      /** Optional logical body owning the element. */
      readonly bodyId?: BodyId;
      /** Exact displayed world-space position under the pointer. */
      readonly worldPosition: Vec3;
    }
  | FacePickHit
  | NodePickHit
  | EdgePickHit;
