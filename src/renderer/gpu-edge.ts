import type { Geometry } from "../geometry/part";
import { buildBodyTrianglePickIds } from "./gpu-pick-ids";

/** Indexed edge geometry plus the body owners of each logical edge. */
export interface MeshEdgeData {
  readonly indices: Uint32Array;
  /** Interleaved owner-array start/count for each edge in `indices`. */
  readonly bodyRanges: Uint32Array;
  /** 1-based body pick ids referenced by `bodyRanges`. */
  readonly bodyIds: Uint32Array;
}

/**
 * Builds a deduplicated line-list of FE edges for the wireframe overlay.
 * Tessellated triangle diagonals are excluded when face/node metadata exists.
 */
export function buildMeshEdges(geometry: Geometry, sourceIndices = geometry.indices): Uint32Array {
  return buildMeshEdgeData(geometry, sourceIndices).indices;
}

/** Builds mesh edges and deterministic body ownership for each edge. */
export function buildMeshEdgeData(
  geometry: Geometry,
  sourceIndices = geometry.indices,
): MeshEdgeData {
  const triangleCount = Math.floor(sourceIndices.length / 3);
  const elementEdges = elementEdgeKeys(geometry);
  const bodyPickIds = buildBodyTrianglePickIds(geometry);
  const sourceBodyIds = triangleBodyIds(geometry, sourceIndices, bodyPickIds);
  const edges: Array<{ readonly a: number; readonly b: number; readonly bodies: Set<number> }> = [];
  const byKey = new Map<string, (typeof edges)[number]>();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const corners = [
      sourceIndices[base] ?? 0,
      sourceIndices[base + 1] ?? 0,
      sourceIndices[base + 2] ?? 0,
    ];
    const bodyPickId = sourceBodyIds[triangle] ?? 0;
    for (let corner = 0; corner < 3; corner++) {
      const a = corners[corner] ?? 0;
      const b = corners[(corner + 1) % 3] ?? 0;
      if (elementEdges !== undefined && !elementEdges.has(nodeEdgeKey(geometry, a, b))) {
        continue;
      }
      const key = edgeKey(geometry, a, b);
      let edge = byKey.get(key);
      if (edge === undefined) {
        edge = { a, b, bodies: new Set() };
        edges.push(edge);
        byKey.set(key, edge);
      }
      if (bodyPickId !== 0) edge.bodies.add(bodyPickId);
    }
  }
  const bodyIds: number[] = [];
  const bodyRanges = new Uint32Array(edges.length * 2);
  const indices = new Uint32Array(edges.length * 2);
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    if (edge === undefined) continue;
    indices[index * 2] = edge.a;
    indices[index * 2 + 1] = edge.b;
    const owners = [...edge.bodies].sort((a, b) => a - b);
    bodyRanges[index * 2] = bodyIds.length;
    bodyRanges[index * 2 + 1] = owners.length;
    bodyIds.push(...owners);
  }
  return {
    indices,
    bodyRanges: bodyRanges.length === 0 ? new Uint32Array([0, 0]) : bodyRanges,
    bodyIds: bodyIds.length === 0 ? new Uint32Array([0]) : new Uint32Array(bodyIds),
  };
}

function triangleBodyIds(
  geometry: Geometry,
  sourceIndices: Uint32Array,
  bodyPickIds: Uint32Array,
): Uint32Array {
  if (sourceIndices === geometry.indices) return bodyPickIds;
  const byTriangle = new Map<string, number>();
  for (let triangle = 0; triangle < geometry.indices.length / 3; triangle++) {
    const base = triangle * 3;
    byTriangle.set(
      triangleKey(
        geometry.indices[base] ?? 0,
        geometry.indices[base + 1] ?? 0,
        geometry.indices[base + 2] ?? 0,
      ),
      bodyPickIds[triangle] ?? 0,
    );
  }
  const result = new Uint32Array(Math.floor(sourceIndices.length / 3));
  for (let triangle = 0; triangle < result.length; triangle++) {
    const base = triangle * 3;
    result[triangle] =
      byTriangle.get(
        triangleKey(
          sourceIndices[base] ?? 0,
          sourceIndices[base + 1] ?? 0,
          sourceIndices[base + 2] ?? 0,
        ),
      ) ?? 0;
  }
  return result;
}

function triangleKey(a: number, b: number, c: number): string {
  return `${a},${b},${c}`;
}

/** Returns declared FE edge keys, or undefined for generic triangle meshes. */
function elementEdgeKeys(geometry: Geometry): Set<string> | undefined {
  const faces = geometry.faces;
  if (faces === undefined || geometry.nodePickIds === undefined) return undefined;
  const edges = new Set<string>();
  for (const face of faces) {
    for (let index = 0; index < face.nodeIds.length; index++) {
      const next = (index + 1) % face.nodeIds.length;
      const a = face.nodeIds[index];
      const b = face.nodeIds[next];
      if (a !== undefined && b !== undefined) {
        edges.add(`${Math.min(a + 1, b + 1)},${Math.max(a + 1, b + 1)}`);
      }
    }
  }
  return edges;
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

/** Maps two tessellated vertex indices to their FE node edge key. */
function nodeEdgeKey(geometry: Geometry, a: number, b: number): string {
  const nodeIds = geometry.nodePickIds;
  const nodeA = nodeIds?.[a] ?? 0;
  const nodeB = nodeIds?.[b] ?? 0;
  return `${Math.min(nodeA, nodeB)},${Math.max(nodeA, nodeB)}`;
}
