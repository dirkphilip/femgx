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

/** Deterministic canonical identity of an edge, independent of direction. */
export type EdgeKey = string;

/** An element edge as an ordered node sequence. */
export interface ElementEdge {
  readonly key: EdgeKey;
  /** `[corner, mid?, corner]`; element-local in `edgesOf`, canonical in `uniqueEdges`. */
  readonly nodeIds: readonly NodeId[];
}

/** Returns the edges of a single element in canonical topology order. */
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
 */
export function uniqueEdges(elements: readonly Element[]): readonly ElementEdge[] {
  const seen = new Map<EdgeKey, ElementEdge>();
  for (const element of elements) {
    for (const edge of edgesOf(element)) {
      if (!seen.has(edge.key)) {
        seen.set(edge.key, canonicalEdge(edge.nodeIds));
      }
    }
  }
  return [...seen.values()].sort(compareEdges);
}

function compareEdges(x: ElementEdge, y: ElementEdge): number {
  const shared = Math.min(x.nodeIds.length, y.nodeIds.length);
  for (let index = 0; index < shared; index += 1) {
    const a = at(x.nodeIds, index);
    const b = at(y.nodeIds, index);
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return x.nodeIds.length - y.nodeIds.length;
}

function canonicalEdge(nodeIds: readonly NodeId[]): ElementEdge {
  if (nodeIds.length === 2) {
    const a = at(nodeIds, 0);
    const b = at(nodeIds, 1);
    const ordered = a <= b ? nodeIds : [b, a];
    return { key: canonicalKey(ordered), nodeIds: ordered };
  }
  const a = at(nodeIds, 0);
  const mid = at(nodeIds, 1);
  const b = at(nodeIds, 2);
  const ordered: readonly NodeId[] = [Math.min(a, b), mid, Math.max(a, b)];
  return { key: canonicalKey(ordered), nodeIds: ordered };
}
