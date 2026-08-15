/**
 * Extraction of unique element edges.
 *
 * Edges are read from the canonical topology in `./shapes` as corner-index
 * pairs; quadratic shapes add the mid-edge node, so an edge is a three-node
 * sequence `[corner, mid, corner]`. Line elements expose their single edge and
 * point elements expose none. `uniqueEdges` deduplicates coincident edges
 * across elements and presents each with a canonical orientation.
 */

import type { Element, NodeId } from "./element";
import { topologyFor } from "./shapes";
import { at } from "./indices";
import { canonicalKey } from "./keys";

/**
 * Deterministic canonical identity of an edge, independent of direction.
 * @category Elements and model editing
 */
export type EdgeKey = string;

/**
 * An element edge as an ordered node sequence.
 * @category Elements and model editing
 */
export interface ElementEdge {
  readonly key: EdgeKey;
  /** `[corner, mid?, corner]`; element-local in `edgesOf`, canonical in `uniqueEdges`. */
  readonly nodeIds: readonly NodeId[];
}

/**
 * Returns the edges of a single element in canonical topology order.
 * @category Elements and model editing
 */
export function edgesOf(element: Element): readonly ElementEdge[] {
  const topology = topologyFor(element.shape);
  return topology.edges.map(([cornerA, cornerB], index) => {
    const nodeIds = [at(element.nodeIds, cornerA), at(element.nodeIds, cornerB)];
    if (topology.order >= 2) {
      nodeIds.splice(1, 0, at(element.nodeIds, at(topology.edgeNodes, index)));
    }
    return { key: canonicalKey(nodeIds), nodeIds };
  });
}

/**
 * Deduplicates edges across elements and returns them sorted in ascending
 * node order. Each edge is presented in ascending corner order with the
 * mid-edge node (if any) kept between the corners.
 * @category Elements and model editing
 */
export function uniqueEdges(elements: readonly Element[]): readonly ElementEdge[] {
  const seen = new Map<EdgeKey, ElementEdge>();
  for (const element of elements) {
    for (const edge of edgesOf(element)) {
      if (!seen.has(edge.key)) {
        seen.set(edge.key, canonicalEdge(edge));
      }
    }
  }
  return [...seen.values()].sort((left, right) => compareNodeIds(left.nodeIds, right.nodeIds));
}

/** Returns the deterministic authored-edge order used by CPU and GPU metadata. */
export function compareNodeIds(left: readonly NodeId[], right: readonly NodeId[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const a = at(left, index);
    const b = at(right, index);
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return left.length - right.length;
}

/** Returns an edge with ascending corner orientation while preserving its identity. */
export function canonicalEdge(edge: ElementEdge): ElementEdge {
  const first = at(edge.nodeIds, 0);
  const last = at(edge.nodeIds, edge.nodeIds.length - 1);
  if (first <= last) return edge;
  return {
    key: edge.key,
    nodeIds: edge.nodeIds.length === 2 ? [last, first] : [last, at(edge.nodeIds, 1), first],
  };
}
