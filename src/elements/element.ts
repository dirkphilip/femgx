import { topologyFor, type ElementShape } from "./shapes";

/** A globally stable identifier for an element within a model. */
export type ElementId = number;

/** Largest element id that can be encoded as the one-based GPU pick id. */
const MAX_ELEMENT_ID = 0xffff_fffe;

/** A globally stable identifier for a node within a model. */
export type NodeId = number;

/**
 * A typed finite element: a stable id, an explicit shape, and the ids of the
 * nodes it connects. `nodeIds` follow the canonical ordering for `shape`
 * (see `topologyFor` in `./shapes`).
 */
export interface Element {
  readonly id: ElementId;
  readonly shape: ElementShape;
  readonly nodeIds: readonly NodeId[];
}

/**
 * Creates an element from an id, shape, and connectivity.
 *
 * Validates that the shape is supported, that the connectivity matches the
 * shape's node count, that node ids are non-negative integers, and that no node
 * is referenced twice. Returns a new element that owns a copy of `nodeIds`.
 */
export function createElement(
  id: ElementId,
  shape: ElementShape,
  nodeIds: readonly NodeId[],
): Element {
  validateElement(id, shape, nodeIds);
  return { id, shape, nodeIds: [...nodeIds] };
}

function validateElement(id: ElementId, shape: ElementShape, nodeIds: readonly NodeId[]): void {
  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_ELEMENT_ID) {
    throw new Error(`Element id must be a safe integer in [0, ${MAX_ELEMENT_ID}], got ${id}`);
  }
  const topology = topologyFor(shape);
  if (nodeIds.length !== topology.nodeCount) {
    throw new Error(
      `Element ${id} of shape ${shape.family} order ${shape.order} expects ${topology.nodeCount} nodes but got ${nodeIds.length}`,
    );
  }
  const seen = new Set<NodeId>();
  for (const nodeId of nodeIds) {
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      throw new Error(
        `Element ${id} has invalid node id ${nodeId}; node ids must be non-negative integers`,
      );
    }
    if (seen.has(nodeId)) {
      throw new Error(`Element ${id} references node ${nodeId} more than once`);
    }
    seen.add(nodeId);
  }
}
