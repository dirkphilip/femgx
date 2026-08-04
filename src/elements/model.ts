import type { Element } from "./element";

/**
 * A CPU-side finite-element model: node coordinates plus typed elements.
 *
 * `nodes` holds one xyz triple per node and is indexed directly by `NodeId`, so
 * node ids must be dense (`0 .. nodeCount - 1`). Element connectivity references
 * node ids into this array. The model is pure data with no renderer dependency;
 * the renderer path tessellates it into reusable part geometry.
 */
export interface ElementModel {
  /** Flat xyz coordinates, three floats per node id. */
  readonly nodes: Float32Array;
  readonly elements: readonly Element[];
}

/**
 * Creates an element model from node coordinates and elements, validating that
 * node ids are dense and that every element reference is in range.
 */
export function createElementModel(
  nodes: readonly number[],
  elements: readonly Element[],
): ElementModel {
  if (nodes.length % 3 !== 0) {
    throw new Error("Node coordinate array length must be a multiple of 3");
  }
  const nodeCount = nodes.length / 3;
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const x = nodes[nodeId * 3] ?? 0;
    const y = nodes[nodeId * 3 + 1] ?? 0;
    const z = nodes[nodeId * 3 + 2] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`Node ${nodeId} has non-finite coordinates`);
    }
  }
  for (const element of elements) {
    for (const nodeId of element.nodeIds) {
      if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId >= nodeCount) {
        throw new Error(`Element ${element.id} references out-of-range node ${nodeId}`);
      }
    }
  }
  return { nodes: new Float32Array(nodes), elements: [...elements] };
}
