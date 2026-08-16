import type {
  ElementTessellation,
  Geometry,
  GeometryEdge,
  GeometryElementBlock,
} from "../../geometry/part";
import {
  buildElementPrimitivePickIds,
  buildTriangleOwnerPairs,
  type TriangleOwnerPair,
} from "../picking/ids";
import { compareEdgeNodeIds } from "../../geometry/part-semantic-index";
import { elementEdgeKeys } from "./authored-edge";
import { appendEdgeConditions } from "./edge-conditions";

/** Expanded edge endpoints plus the body owners of each logical edge. */
export interface MeshEdgeData {
  /** Sequential indices into the expanded endpoint arrays. */
  readonly indices: Uint32Array;
  /** Original geometry vertex index for each expanded endpoint. */
  readonly sourceVertexIndices: Uint32Array;
  /** Logical edge index for each expanded endpoint. */
  readonly edgeIds: Uint32Array;
  /** Expanded endpoint positions, in the same order as `sourceVertexIndices`. */
  readonly positions: Float32Array;
  /** Interleaved owner-array start/count for each logical edge. */
  readonly bodyRanges: Uint32Array;
  /** 1-based owner/neighbor body pick-id pairs referenced by `bodyRanges`. */
  readonly bodyIds: Uint32Array;
  /** 1-based owner/neighbor element pick-id pairs referenced by `bodyRanges`. */
  readonly elementIds: Uint32Array;
  /** Optional 1-based owner/neighbor block pick-id pairs for block-aware parts. */
  readonly blockIds?: Uint32Array;
  /** Stable authored identities, present only when geometry declares edges. */
  readonly edgeKeys?: readonly string[];
  /** Canonical authored node sequences parallel to `edgeKeys`. */
  readonly edgeNodeIds?: readonly (readonly number[])[];
}

interface MeshEdge {
  readonly a: number;
  readonly b: number;
  readonly key: string;
  readonly nodeIds: readonly number[];
  readonly segments: Array<readonly [number, number]>;
  readonly conditions: Set<string>;
}

interface UnownedMeshEdge {
  readonly a: number;
  readonly b: number;
  readonly elementPickIds: number[];
}

interface UnownedEdgeState {
  readonly byFirst: Map<number, Map<number, UnownedMeshEdge>>;
  readonly edges: UnownedMeshEdge[];
}

/** Builds mesh edges and deterministic body ownership for each edge. */
export function buildMeshEdgeData(
  geometry: Geometry,
  sourceIndices = geometry.indices,
  elements: readonly ElementTessellation[] = [],
  blocks: readonly GeometryElementBlock[] = [],
): MeshEdgeData {
  if (
    geometry.primitive === "triangles" &&
    geometry.faces === undefined &&
    elements.length === 0 &&
    blocks.length === 0 &&
    sourceIndices === geometry.indices
  ) {
    return buildUnownedEdgeData(geometry, sourceIndices, elements);
  }
  const elementEdges = elementEdgeKeys(geometry);
  const sourceBodyPairs = remapTriangleOwnerPairs(
    geometry,
    sourceIndices,
    buildTriangleOwnerPairs(geometry, elements, blocks),
  );
  const edges = collectEdges(geometry, sourceIndices, elementEdges, sourceBodyPairs);
  return finalizeEdges(geometry, edges, blocks);
}

function remapTriangleOwnerPairs(
  geometry: Geometry,
  sourceIndices: Uint32Array,
  ownerPairs: readonly TriangleOwnerPair[],
): readonly TriangleOwnerPair[] {
  if (sourceIndices === geometry.indices) return ownerPairs;
  const byTriangle = new Map<string, TriangleOwnerPair>();
  for (let triangle = 0; triangle < geometry.indices.length / 3; triangle++) {
    const base = triangle * 3;
    byTriangle.set(
      triangleKey(
        geometry.indices[base] ?? 0,
        geometry.indices[base + 1] ?? 0,
        geometry.indices[base + 2] ?? 0,
      ),
      ownerPairs[triangle] ?? [0, 0, 0, 0, 0, 0],
    );
  }
  const result: TriangleOwnerPair[] = [];
  for (let triangle = 0; triangle < sourceIndices.length / 3; triangle++) {
    const base = triangle * 3;
    result.push(
      byTriangle.get(
        triangleKey(
          sourceIndices[base] ?? 0,
          sourceIndices[base + 1] ?? 0,
          sourceIndices[base + 2] ?? 0,
        ),
      ) ?? [0, 0, 0, 0, 0, 0],
    );
  }
  return result;
}

function buildUnownedEdgeData(
  geometry: Geometry,
  sourceIndices: Uint32Array,
  elements: readonly ElementTessellation[],
): MeshEdgeData {
  const elementPickIds = buildElementPrimitivePickIds(geometry, elements);
  const state: UnownedEdgeState = {
    byFirst: new Map(),
    edges: [],
  };
  for (let triangle = 0; triangle < sourceIndices.length / 3; triangle += 1) {
    const base = triangle * 3;
    const elementPickId = elementPickIds[triangle] ?? 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const a = sourceIndices[base + corner] ?? 0;
      const b = sourceIndices[base + ((corner + 1) % 3)] ?? 0;
      appendUnownedEdge(geometry, a, b, elementPickId, state);
    }
  }
  return finalizeUnownedEdges(geometry, state.edges);
}

function appendUnownedEdge(
  geometry: Geometry,
  a: number,
  b: number,
  elementPickId: number,
  state: UnownedEdgeState,
): void {
  const [first, second] = edgeEndpoints(geometry, a, b);
  let bySecond = state.byFirst.get(first);
  if (bySecond === undefined) {
    bySecond = new Map();
    state.byFirst.set(first, bySecond);
  }
  let edge = bySecond.get(second);
  if (edge === undefined) {
    edge = { a, b, elementPickIds: [] };
    bySecond.set(second, edge);
    state.edges.push(edge);
  }
  if (edge.elementPickIds.includes(elementPickId)) return;
  let insertAt = edge.elementPickIds.length;
  while (insertAt > 0 && (edge.elementPickIds[insertAt - 1] ?? 0) > elementPickId) {
    insertAt -= 1;
  }
  edge.elementPickIds.splice(insertAt, 0, elementPickId);
}

function edgeEndpoints(geometry: Geometry, a: number, b: number): readonly [number, number] {
  const nodeA = geometry.nodePickIds?.[a] ?? 0;
  const nodeB = geometry.nodePickIds?.[b] ?? 0;
  const first = nodeA !== 0 && nodeB !== 0 ? nodeA : a;
  const second = nodeA !== 0 && nodeB !== 0 ? nodeB : b;
  return first < second ? [first, second] : [second, first];
}

function finalizeUnownedEdges(geometry: Geometry, edges: readonly UnownedMeshEdge[]): MeshEdgeData {
  const conditionCount = edges.reduce((count, edge) => count + edge.elementPickIds.length, 0);
  const bodyRanges = new Uint32Array(edges.length * 2);
  const bodyIds = new Uint32Array(conditionCount * 2);
  const elementIds = new Uint32Array(conditionCount * 2);
  const indices = new Uint32Array(edges.length * 2);
  const sourceVertexIndices = new Uint32Array(edges.length * 2);
  const edgeIds = new Uint32Array(edges.length * 2);
  const positions = new Float32Array(edges.length * 2 * 3);
  let conditionOffset = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge === undefined) continue;
    const endpoint = index * 2;
    indices[endpoint] = endpoint;
    indices[endpoint + 1] = endpoint + 1;
    sourceVertexIndices[endpoint] = edge.a;
    sourceVertexIndices[endpoint + 1] = edge.b;
    edgeIds[endpoint] = index;
    edgeIds[endpoint + 1] = index;
    copyPosition(geometry.positions, edge.a, positions, endpoint);
    copyPosition(geometry.positions, edge.b, positions, endpoint + 1);
    bodyRanges[index * 2] = conditionOffset;
    bodyRanges[index * 2 + 1] = edge.elementPickIds.length;
    for (const elementPickId of edge.elementPickIds) {
      elementIds[conditionOffset * 2] = elementPickId;
      conditionOffset += 1;
    }
  }
  return {
    indices,
    sourceVertexIndices,
    edgeIds,
    positions,
    bodyRanges: bodyRanges.length === 0 ? new Uint32Array([0, 0]) : bodyRanges,
    bodyIds: bodyIds.length === 0 ? new Uint32Array([0]) : bodyIds,
    elementIds: elementIds.length === 0 ? new Uint32Array([0]) : elementIds,
  };
}

function collectEdges(
  geometry: Geometry,
  sourceIndices: Uint32Array,
  elementEdges: Set<string> | ReadonlyMap<string, GeometryEdge> | undefined,
  sourceBodyPairs: readonly TriangleOwnerPair[],
): MeshEdge[] {
  const triangleCount = Math.floor(sourceIndices.length / 3);
  const edges: MeshEdge[] = [];
  const byKey = new Map<string, (typeof edges)[number]>();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const corners = [
      sourceIndices[base] ?? 0,
      sourceIndices[base + 1] ?? 0,
      sourceIndices[base + 2] ?? 0,
    ];
    const [owner, neighbor, element, neighborElement, block, neighborBlock] = sourceBodyPairs[
      triangle
    ] ?? [0, 0, 0, 0, 0, 0];
    for (let corner = 0; corner < 3; corner++) {
      const a = corners[corner] ?? 0;
      const b = corners[(corner + 1) % 3] ?? 0;
      const segmentKey = edgeKey(geometry, a, b);
      if (elementEdges !== undefined && !elementEdges.has(segmentKey)) {
        continue;
      }
      const descriptor =
        elementEdges === undefined || elementEdges instanceof Set
          ? undefined
          : elementEdges.get(segmentKey);
      const key = descriptor?.key ?? edgeKey(geometry, a, b);
      let edge = byKey.get(key);
      if (edge === undefined) {
        edge = {
          a,
          b,
          key,
          nodeIds: descriptor?.nodeIds ?? [nodeIdAt(geometry, a), nodeIdAt(geometry, b)],
          segments: [[a, b]],
          conditions: new Set(),
        };
        edges.push(edge);
        byKey.set(key, edge);
      } else if (descriptor?.nodeIds.length === 3) {
        const sameSegment = edge.segments.some(
          ([first, second]) => (first === a && second === b) || (first === b && second === a),
        );
        if (!sameSegment) edge.segments.push([a, b]);
      }
      // Keep `0` as an explicit unowned owner/neighbor id. It makes topology
      // shared with an unowned element visible when every named body is hidden.
      edge.conditions.add(
        `${owner},${neighbor},${element},${neighborElement},${block},${neighborBlock}`,
      );
    }
  }
  return edges;
}

function finalizeEdges(
  geometry: Geometry,
  edges: readonly MeshEdge[],
  blocks: readonly GeometryElementBlock[] = [],
): MeshEdgeData {
  const orderedEdges =
    geometry.edges === undefined
      ? [...edges]
      : [...edges].sort((left, right) => compareEdgeNodeIds(left.nodeIds, right.nodeIds));
  const bodyIds: number[] = [];
  const elementIds: number[] = [];
  const blockIds: number[] = [];
  const blockAware = blocks.length > 0;
  const bodyRanges = new Uint32Array(orderedEdges.length * 2);
  const segmentCount = orderedEdges.reduce((count, edge) => count + edge.segments.length, 0);
  const indices = new Uint32Array(segmentCount * 2);
  const sourceVertexIndices = new Uint32Array(segmentCount * 2);
  const edgeIds = new Uint32Array(segmentCount * 2);
  const positions = new Float32Array(segmentCount * 2 * 3);
  for (let index = 0, endpoint = 0; index < orderedEdges.length; index++) {
    const edge = orderedEdges[index];
    if (edge === undefined) continue;
    for (const [a, b] of edge.segments) {
      indices[endpoint] = endpoint;
      indices[endpoint + 1] = endpoint + 1;
      sourceVertexIndices[endpoint] = a;
      sourceVertexIndices[endpoint + 1] = b;
      edgeIds[endpoint] = index;
      edgeIds[endpoint + 1] = index;
      copyPosition(geometry.positions, a, positions, endpoint);
      copyPosition(geometry.positions, b, positions, endpoint + 1);
      endpoint += 2;
    }
    appendEdgeConditions({
      encoded: edge.conditions,
      edgeIndex: index,
      blockAware,
      bodyRanges,
      bodyIds,
      elementIds,
      blockIds,
    });
  }
  return {
    indices,
    sourceVertexIndices,
    edgeIds,
    positions,
    bodyRanges: bodyRanges.length === 0 ? new Uint32Array([0, 0]) : bodyRanges,
    bodyIds: bodyIds.length === 0 ? new Uint32Array([0]) : new Uint32Array(bodyIds),
    elementIds: elementIds.length === 0 ? new Uint32Array([0]) : new Uint32Array(elementIds),
    ...(blockAware
      ? { blockIds: blockIds.length === 0 ? new Uint32Array([0]) : new Uint32Array(blockIds) }
      : {}),
    edgeKeys: orderedEdges.map((edge) => edge.key),
    edgeNodeIds: orderedEdges.map((edge) => edge.nodeIds),
  };
}

function copyPosition(
  source: Float32Array,
  sourceVertexIndex: number,
  target: Float32Array,
  endpointIndex: number,
): void {
  const sourceOffset = sourceVertexIndex * 3;
  target.set(source.subarray(sourceOffset, sourceOffset + 3), endpointIndex * 3);
}

function nodeIdAt(geometry: Geometry, vertex: number): number {
  return geometry.nodePickIds?.[vertex] ?? vertex;
}

function edgeKey(geometry: Geometry, a: number, b: number): string {
  const nodeIds = geometry.nodePickIds;
  const nodeA = nodeIds?.[a] ?? 0;
  const nodeB = nodeIds?.[b] ?? 0;
  if (nodeA !== 0 && nodeB !== 0) {
    return `${Math.min(nodeA, nodeB)},${Math.max(nodeA, nodeB)}`;
  }
  return `${Math.min(a, b)},${Math.max(a, b)}`;
}

function triangleKey(a: number, b: number, c: number): string {
  return `${a},${b},${c}`;
}
