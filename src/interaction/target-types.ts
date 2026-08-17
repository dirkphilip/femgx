import type { ElementId, NodeId } from "../elements/element";
import type { EdgeKey } from "../elements/edges";
import type { BodyId, PartId } from "../geometry/part";
import type { InstanceId } from "../scene/types";

/**
 * One stable identity that can be selected, highlighted, or hovered.
 * @category Interaction and picking
 */
export type InteractionTarget =
  | {
      /** Part-level interaction target. */
      readonly kind: "part";
      /** Stable reusable part identifier. */
      readonly partId: PartId;
    }
  | {
      /** Placed-instance interaction target. */
      readonly kind: "instance";
      /** Stable expanded instance identifier. */
      readonly instanceId: InstanceId;
    }
  | {
      /** Body-occurrence interaction target. */
      readonly kind: "body";
      /** Stable expanded instance identifier. */
      readonly instanceId: InstanceId;
      /** Stable body identifier within the part. */
      readonly bodyId: BodyId;
    }
  | {
      /** Element-occurrence interaction target. */
      readonly kind: "element";
      /** Stable expanded instance identifier. */
      readonly instanceId: InstanceId;
      /** Stable authored element identifier. */
      readonly elementId: ElementId;
    }
  | {
      /** Face-occurrence interaction target. */
      readonly kind: "face";
      /** Stable expanded instance identifier. */
      readonly instanceId: InstanceId;
      /** Stable authored element identifier. */
      readonly elementId: ElementId;
      /** Zero-based face index in the element's canonical topology. */
      readonly faceIndex: number;
    }
  | {
      /** Node-occurrence interaction target. */
      readonly kind: "node";
      /** Stable expanded instance identifier. */
      readonly instanceId: InstanceId;
      /** Stable authored node identifier. */
      readonly nodeId: NodeId;
    }
  | {
      /** Authored-edge occurrence interaction target. */
      readonly kind: "edge";
      /** Stable expanded instance identifier. */
      readonly instanceId: InstanceId;
      /** Canonical authored edge key. */
      readonly key: EdgeKey;
    };
