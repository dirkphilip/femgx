import type { ElementId, NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import type { InstanceId } from "../scene/types";

/** Stable reference to one node occurrence (a node placed in the scene). */
export interface NodeRef {
  readonly instanceId: InstanceId;
  readonly nodeId: NodeId;
}

/** Stable reference to one element-face occurrence placed in the scene. */
export interface FaceRef {
  readonly instanceId: InstanceId;
  readonly elementId: ElementId;
  readonly faceKey: FaceKey;
}
