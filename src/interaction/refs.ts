import type { ElementId, NodeId } from "../elements/element";
import type { EdgeKey } from "../elements/edges";
import type { ElementBlockId } from "../elements/model";
import type { BodyId } from "../geometry/part";
import type { InstanceId } from "../scene/types";

/**
 * Stable reference to one body occurrence in a placed part.
 * @category Interaction and picking
 */
export interface BodyRef {
  readonly instanceId: InstanceId;
  readonly bodyId: BodyId;
}

/**
 * Stable reference to one semantic element block occurrence.
 * @category Interaction and picking
 */
export interface ElementBlockRef {
  readonly instanceId: InstanceId;
  readonly blockId: ElementBlockId;
}

/**
 * Stable reference to one node occurrence (a node placed in the scene).
 * @category Interaction and picking
 */
export interface NodeRef {
  readonly instanceId: InstanceId;
  readonly nodeId: NodeId;
}

/**
 * Stable reference to one element-face occurrence placed in the scene.
 * @category Interaction and picking
 */
export interface FaceRef {
  readonly instanceId: InstanceId;
  readonly elementId: ElementId;
  readonly faceIndex: number;
}

/** Stable reference to one authored edge occurrence in a placed part. */
export interface EdgeRef {
  readonly instanceId: InstanceId;
  readonly key: EdgeKey;
}
