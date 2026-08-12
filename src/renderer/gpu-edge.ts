import { bodyIdForElement, type Geometry } from "../geometry/part";
import { buildBodyPrimitivePickIds } from "./gpu-pick-ids";

/** Indexed edge geometry plus the body owners of each logical edge. */
export interface MeshEdgeData {
  readonly indices: Uint32Array;
  /** Interleaved owner-array start/count for each edge in `indices`. */
  readonly bodyRanges: Uint32Array;
  /** 1-based owner/neighbor body pick-id pairs referenced by `bodyRanges`. */
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
  const bodyPickIds = buildBodyPrimitivePickIds(geometry);
  const sourceBodyPairs = triangleBodyPairs(geometry, sourceIndices, bodyPickIds);
  const edges: Array<{
    readonly a: number;
    readonly b: number;
    readonly conditions: Set<string>;
  }> = [];
  const byKey = new Map<string, (typeof edges)[number]>();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const corners = [
      sourceIndices[base] ?? 0,
      sourceIndices[base + 1] ?? 0,
      sourceIndices[base + 2] ?? 0,
    ];
    const [owner, neighbor] = sourceBodyPairs[triangle] ?? [0, 0];
    for (let corner = 0; corner < 3; corner++) {
      const a = corners[corner] ?? 0;
      const b = corners[(corner + 1) % 3] ?? 0;
      if (elementEdges !== undefined && !elementEdges.has(nodeEdgeKey(geometry, a, b))) {
        continue;
      }
      const key = edgeKey(geometry, a, b);
      let edge = byKey.get(key);
      if (edge === undefined) {
        edge = { a, b, conditions: new Set() };
        edges.push(edge);
        byKey.set(key, edge);
      }
      // Keep `0` as an explicit unowned owner/neighbor id. It makes topology
      // shared with an unowned element visible when every named body is hidden.
      edge.conditions.add(`${owner},${neighbor}`);
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
    const conditions = [...edge.conditions]
      .map((value) => value.split(",").map(Number) as [number, number])
      .sort(([ownerA, neighborA], [ownerB, neighborB]) => ownerA - ownerB || neighborA - neighborB);
    bodyRanges[index * 2] = bodyIds.length / 2;
    bodyRanges[index * 2 + 1] = conditions.length;
    for (const [owner, neighbor] of conditions) bodyIds.push(owner, neighbor);
  }
  return {
    indices,
    bodyRanges: bodyRanges.length === 0 ? new Uint32Array([0, 0]) : bodyRanges,
    bodyIds: bodyIds.length === 0 ? new Uint32Array([0]) : new Uint32Array(bodyIds),
  };
}

function triangleBodyPairs(
  geometry: Geometry,
  sourceIndices: Uint32Array,
  bodyPickIds: Uint32Array,
): Array<readonly [number, number]> {
  const facePickIds = geometry.primitive === "triangles" ? geometry.facePickIds : undefined;
  const pairFor = (triangle: number): readonly [number, number] => {
    const owner = bodyPickIds[triangle] ?? 0;
    const faceId = (facePickIds?.[triangle] ?? 0) - 1;
    const neighborElementId =
      geometry.primitive === "triangles"
        ? geometry.faces?.[faceId]?.neighborElementIds[0]
        : undefined;
    const neighborBody =
      neighborElementId === undefined ? undefined : bodyIdForElement(geometry, neighborElementId);
    const neighborPickId = neighborBody === undefined ? 0 : neighborBody + 1;
    return [owner, neighborPickId === owner ? 0 : neighborPickId];
  };
  if (sourceIndices === geometry.indices) {
    return Array.from({ length: Math.floor(sourceIndices.length / 3) }, (_, triangle) =>
      pairFor(triangle),
    );
  }
  const byTriangle = new Map<string, readonly [number, number]>();
  for (let triangle = 0; triangle < geometry.indices.length / 3; triangle++) {
    const base = triangle * 3;
    byTriangle.set(
      triangleKey(
        geometry.indices[base] ?? 0,
        geometry.indices[base + 1] ?? 0,
        geometry.indices[base + 2] ?? 0,
      ),
      pairFor(triangle),
    );
  }
  const result: Array<readonly [number, number]> = [];
  for (let triangle = 0; triangle < sourceIndices.length / 3; triangle++) {
    const base = triangle * 3;
    result.push(
      byTriangle.get(
        triangleKey(
          sourceIndices[base] ?? 0,
          sourceIndices[base + 1] ?? 0,
          sourceIndices[base + 2] ?? 0,
        ),
      ) ?? [0, 0],
    );
  }
  return result;
}

function triangleKey(a: number, b: number, c: number): string {
  return `${a},${b},${c}`;
}

/** Returns declared FE edge keys, or undefined for generic triangle meshes. */
function elementEdgeKeys(geometry: Geometry): Set<string> | undefined {
  if (geometry.primitive !== "triangles") return undefined;
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
