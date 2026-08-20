import { faceCornerLoops } from "../elements/faces";
import {
  elementModelIdAt,
  elementModelNodeIdAt,
  elementModelTopologyAt,
} from "../elements/model-topology";
import type { ElementModel } from "../elements/model";
import type { DirectEdgeSources } from "./semantic/direct-edge-columns";
import { createDirectEdgeCandidates, directEdgeSources } from "./semantic/surface-edge-fragments";

/**
 * Builds sorted authored-edge CSR columns directly from dense model rows.
 *
 * This is intentionally one indexed kernel: allocating `Element` descriptors
 * or per-row node arrays here would dominate large-model edge compilation.
 */
export function authoredEdgeSourcesForOrdinals(
  model: ElementModel,
  ordinals: Uint32Array,
): DirectEdgeSources {
  const sizes = candidateSizes(model, ordinals);
  const candidates = createDirectEdgeCandidates(sizes.edges, sizes.nodes, sizes.faces);
  fillCandidates(candidates, model, ordinals);
  return directEdgeSources(candidates);
}

function candidateSizes(
  model: ElementModel,
  ordinals: Uint32Array,
): { readonly edges: number; readonly nodes: number; readonly faces: number } {
  let edges = 0;
  let nodes = 0;
  let faces = 0;
  for (let index = 0; index < ordinals.length; index += 1) {
    const topology = elementModelTopologyAt(model, ordinals[index] ?? 0);
    const edgeCount = topology.edges.length;
    edges += edgeCount;
    nodes += edgeCount * (topology.order >= 2 ? 3 : 2);
    const loops = faceCornerLoops(topology.family);
    for (let edge = 0; edge < edgeCount; edge += 1) {
      const pair = topology.edges[edge];
      if (pair === undefined) throw new Error("Element topology has no edge");
      for (let face = 0; face < loops.length; face += 1) {
        const loop = loops[face];
        if (loop !== undefined && loopContainsEdge(loop, pair[0], pair[1])) faces += 1;
      }
    }
  }
  return { edges, nodes, faces };
}

function fillCandidates(
  candidates: ReturnType<typeof createDirectEdgeCandidates>,
  model: ElementModel,
  ordinals: Uint32Array,
): void {
  let edgeOutput = 0;
  let nodeOutput = 0;
  let faceOutput = 0;
  for (let index = 0; index < ordinals.length; index += 1) {
    const ordinal = ordinals[index] ?? 0;
    const topology = elementModelTopologyAt(model, ordinal);
    const id = elementModelIdAt(model, ordinal);
    const loops = faceCornerLoops(topology.family);
    for (let edge = 0; edge < topology.edges.length; edge += 1) {
      const pair = topology.edges[edge];
      if (pair === undefined) throw new Error("Element topology has no edge");
      candidates.nodeOffsets[edgeOutput] = nodeOutput;
      nodeOutput = appendEdge(candidates.nodeIds, nodeOutput, {
        model,
        ordinal,
        topology,
        edge,
        pair,
      });
      candidates.incidentElementIds[edgeOutput] = id;
      candidates.faceOffsets[edgeOutput] = faceOutput;
      for (let face = 0; face < loops.length; face += 1) {
        const loop = loops[face];
        if (loop === undefined || !loopContainsEdge(loop, pair[0], pair[1])) continue;
        candidates.faceElementIds[faceOutput] = id;
        candidates.faceIndices[faceOutput] = face;
        faceOutput += 1;
      }
      edgeOutput += 1;
    }
  }
  candidates.nodeOffsets[edgeOutput] = nodeOutput;
  candidates.faceOffsets[edgeOutput] = faceOutput;
}

function appendEdge(
  target: Uint32Array,
  offset: number,
  input: {
    readonly model: ElementModel;
    readonly ordinal: number;
    readonly topology: ReturnType<typeof elementModelTopologyAt>;
    readonly edge: number;
    readonly pair: readonly [number, number];
  },
): number {
  const { model, ordinal, topology, edge, pair } = input;
  const first = elementModelNodeIdAt(model, ordinal, pair[0]);
  const last = elementModelNodeIdAt(model, ordinal, pair[1]);
  const middle = topology.order < 2 ? undefined : topology.edgeNodes[edge];
  if (first <= last) {
    target[offset] = first;
    if (middle !== undefined) target[offset + 1] = elementModelNodeIdAt(model, ordinal, middle);
    target[offset + (middle === undefined ? 1 : 2)] = last;
  } else {
    target[offset] = last;
    if (middle !== undefined) target[offset + 1] = elementModelNodeIdAt(model, ordinal, middle);
    target[offset + (middle === undefined ? 1 : 2)] = first;
  }
  return offset + (middle === undefined ? 2 : 3);
}

function loopContainsEdge(loop: readonly number[], first: number, last: number): boolean {
  let firstPresent = false;
  let lastPresent = false;
  for (let index = 0; index < loop.length; index += 1) {
    const value = loop[index];
    if (value === first) firstPresent = true;
    else if (value === last) lastPresent = true;
  }
  return firstPresent && lastPresent;
}
