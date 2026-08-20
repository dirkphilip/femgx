import type { Part } from "./part";
import { ordinalForId } from "../elements/model-storage";
import { partSemanticGraph, type PartSemanticGraph } from "./semantic/part-semantic-graph";
import {
  graphBodyAt,
  graphEdgeAt,
  graphElementAt,
  graphFaceAt,
} from "./semantic/part-semantic-views";
import type { PartSemanticIndex } from "./part-semantic-types";

export type { FaceMetadata, PartSemanticIndex } from "./part-semantic-types";
export { compareNodeIds as compareEdgeNodeIds } from "../elements/edges";

const indexByPart = new WeakMap<Part, PartSemanticIndex>();

/** Returns graph-backed semantic lookups; raw display parts have an empty capability. */
export function getPartSemanticIndex(part: Part): PartSemanticIndex {
  const cached = indexByPart.get(part);
  if (cached !== undefined) return cached;
  const graph = partSemanticGraph(part);
  const index =
    graph === undefined ? emptySemanticIndex(part) : buildGraphSemanticIndex(graph, part);
  indexByPart.set(part, index);
  return index;
}

function buildGraphSemanticIndex(graph: PartSemanticGraph, part: Part): PartSemanticIndex {
  const triangle = buildTriangleCsr(graph, part);
  return {
    elementCount: graph.elementIds.length,
    element: (id) => graphElement(graph, id),
    hasElement: (id) => graphElementOrdinal(graph, id) !== undefined,
    elementOrdinal: (id) => graphElementOrdinal(graph, id),
    body: (id) => graphBody(graph, id),
    hasBody: (id) => graphBodyOrdinal(graph, id) !== undefined,
    bodyForElement: (id) => graphBodyForElement(graph, id),
    face: (elementId, faceIndex) => graphFace(graph, elementId, faceIndex),
    hasFace: (elementId, faceIndex) => graphFace(graph, elementId, faceIndex) !== undefined,
    edge: (key) => graphEdge(graph, key),
    hasEdge: (key) => graphEdge(graph, key) !== undefined,
    hasVisibilityBody: (id) => containsSorted(graph.surfaceBodyIds, id),
    nodeCount: triangle.nodeCount,
    nodeTriangleFaceOffsets: triangle.nodeOffsets,
    nodeTriangleFaceIds: triangle.nodeFaceIds,
    neighborTriangleFaceOffsets: triangle.completeNeighbors
      ? triangle.neighborOffsets
      : new Uint32Array(0),
    neighborTriangleFaceIds: triangle.neighborFaceIds,
    nonTriangleElementOrdinals:
      triangle.hasBoundaryFaceSubset && triangle.completeNeighbors
        ? nonTriangleOrdinals(graph)
        : new Uint32Array(0),
    hasBoundaryFaceSubset: triangle.hasBoundaryFaceSubset,
    hasCompleteNeighborTriangleIndex: triangle.completeNeighbors,
  };
}

function emptySemanticIndex(part: Part): PartSemanticIndex {
  return {
    elementCount: 0,
    element: () => undefined,
    hasElement: () => false,
    elementOrdinal: () => undefined,
    body: () => undefined,
    hasBody: () => false,
    bodyForElement: () => undefined,
    face: () => undefined,
    hasFace: () => false,
    edge: () => undefined,
    hasEdge: () => false,
    hasVisibilityBody: () => false,
    nodeCount: Math.floor((part.nodePositions?.length ?? 0) / 3),
    nodeTriangleFaceOffsets: new Uint32Array(0),
    nodeTriangleFaceIds: new Uint32Array(0),
    neighborTriangleFaceOffsets: new Uint32Array(0),
    neighborTriangleFaceIds: new Uint32Array(0),
    nonTriangleElementOrdinals: new Uint32Array(0),
    hasBoundaryFaceSubset: false,
    hasCompleteNeighborTriangleIndex: false,
  };
}

function graphElement(graph: PartSemanticGraph, id: number) {
  const ordinal = graphElementOrdinal(graph, id);
  return ordinal === undefined ? undefined : graphElementAt(graph, ordinal - 1);
}

function graphElementOrdinal(graph: PartSemanticGraph, id: number): number | undefined {
  const ordinal = ordinalForId(graph.elementIds, graph.elementIdOrdinals, id);
  return ordinal === undefined ? undefined : ordinal + 1;
}

function graphBody(graph: PartSemanticGraph, id: number) {
  const ordinal = graphBodyOrdinal(graph, id);
  return ordinal === undefined ? undefined : graphBodyAt(graph, ordinal);
}

function graphBodyOrdinal(graph: PartSemanticGraph, id: number): number | undefined {
  return ordinalForId(graph.bodyIds, graph.bodyIdOrdinals, id);
}

function graphBodyForElement(graph: PartSemanticGraph, id: number): number | undefined {
  const ordinal = graphElementOrdinal(graph, id);
  const bodyId = ordinal === undefined ? 0 : (graph.elementBodyIds[ordinal - 1] ?? 0);
  return bodyId === 0 ? undefined : bodyId;
}

function graphFace(graph: PartSemanticGraph, elementId: number, faceIndex: number) {
  const elementOrdinal = graphElementOrdinal(graph, elementId);
  if (elementOrdinal === undefined) return undefined;
  let low = 0;
  let high = graph.faceLookupOrdinals.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const ordinal = graph.faceLookupOrdinals[middle] ?? 0;
    const owner = graph.faceOwnerElementOrdinals[ordinal] ?? 0;
    const index = graph.faceIndices[ordinal] ?? 0;
    if (owner === elementOrdinal - 1 && index === faceIndex) {
      const face = graphFaceAt(graph, ordinal);
      return face === undefined ? undefined : { face, faceId: ordinal };
    }
    if (owner < elementOrdinal - 1 || (owner === elementOrdinal - 1 && index < faceIndex)) {
      low = middle + 1;
    } else high = middle - 1;
  }
  return undefined;
}

function graphEdge(graph: PartSemanticGraph, key: string) {
  const hash = hashEdgeKey(key);
  if (hash === undefined || graph.edgeIndexHeads.length === 0) return undefined;
  for (
    let ordinal = graph.edgeIndexHeads[hash & (graph.edgeIndexHeads.length - 1)] ?? -1;
    ordinal !== -1;
    ordinal = graph.edgeIndexNext[ordinal] ?? -1
  ) {
    if (graph.edgeIndexHashes[ordinal] === hash && edgeKeyMatches(graph, ordinal, key)) {
      return graphEdgeAt(graph, ordinal);
    }
  }
  return undefined;
}

function containsSorted(values: Uint32Array, target: number): boolean {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = values[middle] ?? 0;
    if (value === target) return true;
    if (value < target) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function hashEdgeKey(key: string): number | undefined {
  let first = 0;
  let second = 0;
  let third = 0;
  let count = 0;
  let value = 0;
  let digits = 0;
  for (let index = 0; index <= key.length; index += 1) {
    const code = index === key.length ? 44 : key.charCodeAt(index);
    if (code === 44) {
      if (digits === 0 || count === 3) return undefined;
      if (count === 0) first = value;
      else if (count === 1) second = value;
      else third = value;
      count += 1;
      value = 0;
      digits = 0;
    } else if (code >= 48 && code <= 57) {
      value = value * 10 + code - 48;
      digits += 1;
    } else return undefined;
  }
  if (count < 2 || count > 3) return undefined;
  const finalThird = count === 3 ? third : undefined;
  const low = Math.min(first, second, finalThird ?? first);
  const high = Math.max(first, second, finalThird ?? second);
  const middle = finalThird === undefined ? undefined : first + second + finalThird - low - high;
  let hash = Math.imul(2_166_136_261 ^ low, 16_777_619) >>> 0;
  if (middle !== undefined) hash = Math.imul(hash ^ middle, 16_777_619) >>> 0;
  return Math.imul(hash ^ high, 16_777_619) >>> 0;
}

function edgeKeyMatches(graph: PartSemanticGraph, ordinal: number, key: string): boolean {
  const first = graph.edgeNodeOffsets[ordinal] ?? 0;
  const last = graph.edgeNodeOffsets[ordinal + 1] ?? first;
  let firstId = graph.edgeNodeIds[first] ?? 0;
  let secondId = graph.edgeNodeIds[first + 1] ?? 0;
  const thirdId = graph.edgeNodeIds[first + 2] ?? 0;
  const count = last - first;
  if (count === 2 && firstId > secondId) [firstId, secondId] = [secondId, firstId];
  const low = count === 3 ? Math.min(firstId, secondId, thirdId) : firstId;
  const high = count === 3 ? Math.max(firstId, secondId, thirdId) : secondId;
  const middle = count === 3 ? firstId + secondId + thirdId - low - high : 0;
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const expected = String(
      count === 3
        ? index === 0
          ? low
          : index === 1
            ? middle
            : high
        : index === 0
          ? firstId
          : secondId,
    );
    if (!key.startsWith(expected, cursor)) return false;
    cursor += expected.length;
    if (index + 1 < count) {
      if (key.charCodeAt(cursor) !== 44) return false;
      cursor += 1;
    }
  }
  return cursor === key.length;
}

interface TriangleCsr {
  readonly nodeCount: number;
  readonly nodeOffsets: Uint32Array;
  readonly nodeFaceIds: Uint32Array;
  readonly neighborOffsets: Uint32Array;
  readonly neighborFaceIds: Uint32Array;
  readonly completeNeighbors: boolean;
  readonly hasBoundaryFaceSubset: boolean;
}

function buildTriangleCsr(graph: PartSemanticGraph, part: Part): TriangleCsr {
  const nodeCount = Math.floor((part.nodePositions?.length ?? 0) / 3);
  const triangles = part.geometries.some((geometry) => geometry.primitive === "triangles");
  const nodeOffsets = triangles ? new Uint32Array(nodeCount + 1) : new Uint32Array(0);
  const neighborOffsets = triangles
    ? new Uint32Array(graph.elementIds.length + 1)
    : new Uint32Array(0);
  let completeNeighbors = true;
  for (let face = 0; face < graph.faceIndices.length; face += 1) {
    const first = graph.faceNodeOffsets[face] ?? 0;
    const last = graph.faceNodeOffsets[face + 1] ?? first;
    for (let index = first; index < last; index += 1) {
      const node = graph.faceNodeIds[index] ?? nodeCount;
      if (node < nodeCount) nodeOffsets[node + 1] = (nodeOffsets[node + 1] ?? 0) + 1;
    }
    if (graph.faceNeighborMissing[face] === 1) completeNeighbors = false;
    const neighbor = graph.faceNeighborElementOrdinals[face] ?? 0;
    if (neighbor !== 0) {
      if (neighbor > graph.elementIds.length) completeNeighbors = false;
      else neighborOffsets[neighbor] = (neighborOffsets[neighbor] ?? 0) + 1;
    }
  }
  prefix(nodeOffsets);
  if (completeNeighbors) prefix(neighborOffsets);
  const nodeFaceIds = new Uint32Array(nodeOffsets[nodeCount] ?? 0);
  const neighborFaceIds = completeNeighbors
    ? new Uint32Array(neighborOffsets[neighborOffsets.length - 1] ?? 0)
    : new Uint32Array(0);
  const nodeCursor = nodeOffsets.slice(0, -1);
  const neighborCursor = completeNeighbors ? neighborOffsets.slice(0, -1) : new Uint32Array(0);
  for (let face = 0; face < graph.faceIndices.length; face += 1) {
    const first = graph.faceNodeOffsets[face] ?? 0;
    const last = graph.faceNodeOffsets[face + 1] ?? first;
    for (let index = first; index < last; index += 1) {
      const node = graph.faceNodeIds[index] ?? nodeCount;
      if (node >= nodeCount) continue;
      const cursor = nodeCursor[node] ?? 0;
      nodeFaceIds[cursor] = face;
      nodeCursor[node] = cursor + 1;
    }
    const neighbor = graph.faceNeighborElementOrdinals[face] ?? 0;
    if (completeNeighbors && neighbor !== 0) {
      const cursor = neighborCursor[neighbor - 1] ?? 0;
      neighborFaceIds[cursor] = face;
      neighborCursor[neighbor - 1] = cursor + 1;
    }
  }
  return {
    nodeCount,
    nodeOffsets,
    nodeFaceIds,
    neighborOffsets,
    neighborFaceIds,
    completeNeighbors,
    hasBoundaryFaceSubset: boundarySubset(graph, part),
  };
}

function prefix(values: Uint32Array): void {
  for (let index = 1; index < values.length; index += 1)
    values[index] = (values[index] ?? 0) + (values[index - 1] ?? 0);
}

function nonTriangleOrdinals(graph: PartSemanticGraph): Uint32Array {
  let count = 0;
  for (let element = 0; element < graph.elementIds.length; element += 1) {
    const first = graph.elementRangeOffsets[element] ?? 0;
    const last = graph.elementRangeOffsets[element + 1] ?? first;
    for (let range = first; range < last; range += 1)
      if ((graph.elementRangePrimitiveCodes[range] ?? 0) !== 0) {
        count += 1;
        break;
      }
  }
  const result = new Uint32Array(count);
  let output = 0;
  for (let element = 0; element < graph.elementIds.length; element += 1) {
    const first = graph.elementRangeOffsets[element] ?? 0;
    const last = graph.elementRangeOffsets[element + 1] ?? first;
    for (let range = first; range < last; range += 1)
      if ((graph.elementRangePrimitiveCodes[range] ?? 0) !== 0) {
        result[output++] = element + 1;
        break;
      }
  }
  return result;
}

function boundarySubset(graph: PartSemanticGraph, part: Part): boolean {
  const geometryOrdinal = part.geometries.findIndex(
    (geometry) => geometry.primitive === "triangles",
  );
  const triangle = part.geometries[geometryOrdinal];
  if (triangle?.primitive !== "triangles" || triangle.faceSubset === undefined) return false;
  const first = graph.faceSubsetOffsets[geometryOrdinal] ?? 0;
  const last = graph.faceSubsetOffsets[geometryOrdinal + 1] ?? first;
  for (let index = first; index < last; index += 1)
    if (
      (graph.faceNeighborElementOrdinals[
        graph.faceSubsetOrdinals[index] ?? graph.faceIndices.length
      ] ?? 0) !== 0
    )
      return false;
  return true;
}
