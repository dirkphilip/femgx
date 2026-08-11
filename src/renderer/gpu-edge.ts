import type { Geometry } from "../geometry/part";

/**
 * Builds a deduplicated line-list of FE edges for the wireframe overlay.
 * Tessellated triangle diagonals are excluded when face/node metadata exists.
 */
export function buildMeshEdges(geometry: Geometry, sourceIndices = geometry.indices): Uint32Array {
  const indices = sourceIndices;
  const triangleCount = Math.floor(indices.length / 3);
  const elementEdges = elementEdgeKeys(geometry);
  const seen = new Set<string>();
  const edges: number[] = [];
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const corners = [indices[base] ?? 0, indices[base + 1] ?? 0, indices[base + 2] ?? 0];
    for (let corner = 0; corner < 3; corner++) {
      const a = corners[corner] ?? 0;
      const b = corners[(corner + 1) % 3] ?? 0;
      if (elementEdges !== undefined && !elementEdges.has(nodeEdgeKey(geometry, a, b))) {
        continue;
      }
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }
  return new Uint32Array(edges);
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

/** Maps two tessellated vertex indices to their FE node edge key. */
function nodeEdgeKey(geometry: Geometry, a: number, b: number): string {
  const nodeIds = geometry.nodePickIds;
  const nodeA = nodeIds?.[a] ?? 0;
  const nodeB = nodeIds?.[b] ?? 0;
  return `${Math.min(nodeA, nodeB)},${Math.max(nodeA, nodeB)}`;
}
