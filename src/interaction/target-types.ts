import type { ElementId, NodeId } from "../elements/element";
import type { BodyId, PartId } from "../geometry/part";
import type { InstanceId } from "../scene/types";

/** One stable identity that can be selected, highlighted, or hovered. */
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
  | { readonly kind: "node"; readonly instanceId: InstanceId; readonly nodeId: NodeId };
