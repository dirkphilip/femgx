import type { ElementTessellation, Geometry, GeometryEdge } from "../../geometry/part";
import { buildTriangleOwnerPairs, type TriangleOwnerPair } from "../picking/ids";
import { compareEdgeNodeIds } from "../../geometry/part-semantic-index";
import { elementEdgeKeys } from "./authored-edge";
import { appendEdgeConditions } from "./edge-conditions";
import { buildDenseUnownedEdgeData, buildDenseUnownedEdges } from "./dense-unowned-edge";
import type { MeshEdgeData } from "./mesh-edge-types";
export type { MeshEdgeData } from "./mesh-edge-types";

export interface MeshEdgePresentationBuild {
  readonly edgeData: MeshEdgeData;
  readonly primitiveElementPickIds?: Uint32Array;
}

interface MeshEdge {
  readonly a: number;
  readonly b: number;
  readonly key: string;
  readonly nodeIds: readonly number[];
  readonly segments: Array<readonly [number, number]>;
  readonly conditions: Set<string>;
}

/** Builds mesh edges and deterministic body ownership for each edge. */
export function buildMeshEdgeData(
  geometry: Geometry,
  sourceIndices = geometry.indices,
  elements: readonly ElementTessellation[] = [],
): MeshEdgeData {
  if (
    geometry.primitive === "triangles" &&
    geometry.faces === undefined &&
    elements.length === 0 &&
    sourceIndices === geometry.indices
  ) {
    return buildDenseUnownedEdgeData(geometry, elements);
  }
  const elementEdges = elementEdgeKeys(geometry);
  const sourceBodyPairs = remapTriangleOwnerPairs(
    geometry,
    sourceIndices,
    buildTriangleOwnerPairs(geometry, elements),
  );
  const edges = collectEdges(geometry, sourceIndices, elementEdges, sourceBodyPairs);
  return finalizeEdges(geometry, edges);
}

/** Builds unowned display edges and retains dense primitive metadata for the upload owner. */
export function buildUnownedMeshEdgePresentation(
  geometry: Geometry,
  sourceIndices = geometry.indices,
  elements: readonly ElementTessellation[] = [],
): MeshEdgePresentationBuild {
  if (
    geometry.primitive === "triangles" &&
    geometry.faces === undefined &&
    geometry.edges === undefined &&
    sourceIndices === geometry.indices
  ) {
    return buildDenseUnownedEdges(geometry, elements);
  }
  return { edgeData: buildMeshEdgeData(geometry, sourceIndices, elements) };
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
      ownerPairs[triangle] ?? [0, 0, 0, 0],
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
      ) ?? [0, 0, 0, 0],
    );
  }
  return result;
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
    const [owner, neighbor, element, neighborElement] = sourceBodyPairs[triangle] ?? [0, 0, 0, 0];
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
      edge.conditions.add(`${owner},${neighbor},${element},${neighborElement}`);
    }
  }
  return edges;
}

function finalizeEdges(geometry: Geometry, edges: readonly MeshEdge[]): MeshEdgeData {
  const orderedEdges =
    geometry.edges === undefined
      ? [...edges]
      : [...edges].sort((left, right) => compareEdgeNodeIds(left.nodeIds, right.nodeIds));
  const bodyIds: number[] = [];
  const elementIds: number[] = [];
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
      bodyRanges,
      bodyIds,
      elementIds,
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
