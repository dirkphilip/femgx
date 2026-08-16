import type { ElementId, NodeId } from "../elements/element";
import type { EdgeKey } from "../elements/edges";
import type { BodyId, PartId } from "../geometry/part";
import type { InstanceId } from "../scene/types";

/**
 * One stable identity that can be selected, highlighted, or hovered.
 * @category Interaction and picking
 */
export type InteractionTarget =
  | { readonly kind: "part"; readonly partId: PartId }
  | { readonly kind: "instance"; readonly instanceId: InstanceId }
  | { readonly kind: "body"; readonly instanceId: InstanceId; readonly bodyId: BodyId }
  | { readonly kind: "element"; readonly instanceId: InstanceId; readonly elementId: ElementId }
  | {
      readonly kind: "face";
      readonly instanceId: InstanceId;
      readonly elementId: ElementId;
      readonly faceIndex: number;
    }
  | { readonly kind: "node"; readonly instanceId: InstanceId; readonly nodeId: NodeId }
  | { readonly kind: "edge"; readonly instanceId: InstanceId; readonly key: EdgeKey };
