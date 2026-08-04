import type { NodeId } from "./element";

/**
 * Deterministic canonical identity for an unordered set of node ids.
 *
 * Node ids are sorted ascending and joined with commas, so any two sets of the
 * same node ids produce the same key regardless of traversal order or the
 * element they came from. Used to deduplicate coincident faces and edges.
 */
export function canonicalKey(nodeIds: readonly NodeId[]): string {
  return [...nodeIds].sort((a, b) => a - b).join(",");
}
