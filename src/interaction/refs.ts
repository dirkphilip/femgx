import type { ElementId, NodeId } from "../elements/element";
import type { EdgeKey } from "../elements/edges";
import type { BodyId } from "../geometry/part";
import type { PartOccurrenceId } from "../scene/types";

/**
 * Stable reference to one body occurrence in a placed part.
 * @category Interaction and picking
 */
export interface BodyRef {
  /** Stable expanded instance identifier. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** Stable body identifier within that part. */
  readonly bodyId: BodyId;
}

/**
 * Stable reference to one node occurrence (a node placed in the scene).
 * @category Interaction and picking
 */
export interface NodeRef {
  /** Stable expanded instance identifier. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** Stable authored node identifier. */
  readonly nodeId: NodeId;
}

/**
 * Stable reference to one element-face occurrence placed in the scene.
 * @category Interaction and picking
 */
export interface FaceRef {
  /** Stable expanded instance identifier. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** Stable authored element identifier. */
  readonly elementId: ElementId;
  /** Zero-based canonical face index. */
  readonly faceIndex: number;
}

/** Stable reference to one authored edge occurrence in a placed part. */
export interface EdgeRef {
  /** Stable expanded instance identifier. */
  readonly partOccurrenceId: PartOccurrenceId;
  /** Canonical authored edge key. */
  readonly key: EdgeKey;
}
