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
  readonly kind: "face";
  readonly partId: PartId;
  readonly instanceId: InstanceId;
  readonly elementId: ElementId;
  /** Optional logical body owning the face's element. */
  readonly bodyId?: BodyId;
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
  readonly kind: "node";
  readonly partId: PartId;
  readonly instanceId: InstanceId;
  /** The element whose tessellation was hit, when the node has one. */
  readonly elementId?: ElementId;
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

/** The most-specific resolved authored-edge hit with stable topology data. */
export interface EdgePickHit {
  readonly kind: "edge";
  readonly partId: PartId;
  readonly instanceId: InstanceId;
  readonly key: EdgeKey;
  readonly nodeIds: readonly NodeId[];
  readonly incidentElementIds: readonly ElementId[];
  readonly faceRefs: readonly FaceIdRef[];
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
  | NodePickHit
  | EdgePickHit;
