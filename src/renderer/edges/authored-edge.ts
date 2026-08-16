import type { Geometry, GeometryEdge } from "../../geometry/part";

/** Returns declared FE edge segments, or undefined for generic triangle meshes. */
export function elementEdgeKeys(
  geometry: Geometry,
): Set<string> | ReadonlyMap<string, GeometryEdge> | undefined {
  if (geometry.primitive !== "triangles") return undefined;
  if (geometry.edges !== undefined && geometry.nodePickIds !== undefined) {
    const segments = new Map<string, GeometryEdge>();
    for (const edge of geometry.edges) {
      const nodeIds = edge.nodeIds;
      const pairs =
        nodeIds.length === 2
          ? [[nodeIds[0], nodeIds[1]]]
          : [
              [nodeIds[0], nodeIds[1]],
              [nodeIds[1], nodeIds[2]],
            ];
      for (const [first, second] of pairs) {
        if (first === undefined || second === undefined) continue;
        segments.set(segmentKey(first, second), edge);
      }
    }
    return segments;
  }
  const faces = geometry.faces;
  if (faces === undefined || geometry.nodePickIds === undefined) return undefined;
  const edges = new Set<string>();
  for (const face of faces) {
    for (let index = 0; index < face.nodeIds.length; index += 1) {
      const next = (index + 1) % face.nodeIds.length;
      const a = face.nodeIds[index];
      const b = face.nodeIds[next];
      if (a !== undefined && b !== undefined) edges.add(segmentKey(a, b));
    }
  }
  return edges;
}

function segmentKey(first: number, second: number): string {
  return `${Math.min(first + 1, second + 1)},${Math.max(first + 1, second + 1)}`;
}
