import { topologyFor, type ElementShape } from "./shapes";

/**
 * A globally stable identifier for an element within a model.
 * @category Elements and model editing
 */
export type ElementId = number;

/** Largest element id that can be encoded as the one-based GPU pick id. */
const MAX_ELEMENT_ID = 0xffff_fffe;

/**
 * A globally stable identifier for a node within a model.
 * @category Elements and model editing
 */
export type NodeId = number;

/**
 * A typed finite element: a stable id, an explicit shape, and the ids of the
 * nodes it connects. `nodeIds` follow the canonical ordering for `shape`
 * (see `topologyFor` in `./shapes`). The id is preserved into the compiled
 * {@link root.Part} and is the identity used by element picking and elemental
 * result fields; it is not a generated triangle index.
 * @category Elements and model editing
 */
export interface Element {
  readonly id: ElementId;
  readonly shape: ElementShape;
  readonly nodeIds: readonly NodeId[];
}

/**
 * Creates an element from an id, shape, and connectivity.
 *
 * The `ElementShape` type admits only supported shapes. This validates that the
 * connectivity matches the shape's node count, that node ids are non-negative
 * integers, and that no node is referenced twice. Returns a new element that owns a copy of `nodeIds`;
 * the source connectivity may therefore be reused for another authoring
 * operation.
 * @example Author one triangle.
 * ```ts
 * import { ElementShape, createElement } from "femgx/model";
 *
 * const element = createElement(100, ElementShape.Triangle, [0, 1, 2]);
 * ```
 * @category Elements and model editing
 */
export function createElement(
  id: ElementId,
  shape: ElementShape,
  nodeIds: readonly NodeId[],
): Element {
  validateElement(id, shape, nodeIds);
  return { id, shape, nodeIds: [...nodeIds] };
}

/**
 * Creates an element around connectivity already owned by a validated internal
 * conversion. The caller must not expose or mutate `nodeIds` after this handoff.
 * @internal
 */
export function createOwnedElement(
  id: ElementId,
  shape: ElementShape,
  nodeIds: readonly NodeId[],
): Element {
  validateOwnedElement(id, nodeIds);
  return { id, shape, nodeIds };
}

function validateElement(id: ElementId, shape: ElementShape, nodeIds: readonly NodeId[]): void {
  validateElementId(id);
  const topology = topologyFor(shape);
  if (nodeIds.length !== topology.nodeCount) {
    throw new Error(
      `Element ${id} of shape ${shape} expects ${topology.nodeCount} nodes but got ${nodeIds.length}`,
    );
  }
  const seen = new Set<NodeId>();
  for (const nodeId of nodeIds) {
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      throw new Error(
        `Element ${id} has invalid node id ${nodeId}; node ids must be non-negative integers`,
      );
    }
    assertUniqueNodeId(id, nodeId, seen);
  }
}

function validateOwnedElement(id: ElementId, nodeIds: readonly NodeId[]): void {
  validateElementId(id);
  const seen = new Set<NodeId>();
  for (const nodeId of nodeIds) assertUniqueNodeId(id, nodeId, seen);
}

function validateElementId(id: ElementId): void {
  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_ELEMENT_ID) {
    throw new Error(`Element id must be a safe integer in [0, ${MAX_ELEMENT_ID}], got ${id}`);
  }
}

function assertUniqueNodeId(id: ElementId, nodeId: NodeId, seen: Set<NodeId>): void {
  if (seen.has(nodeId)) {
    throw new Error(`Element ${id} references node ${nodeId} more than once`);
  }
  seen.add(nodeId);
}
