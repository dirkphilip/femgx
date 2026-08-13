import type { Geometry } from "../geometry/part";

/** Expanded surface data whose draw vertices have explicit primitive owners. */
export interface SurfaceVertexData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
  readonly primitiveIds: Uint32Array;
}

/** Builds an edge-endpoint node map for the displacement storage binding. */
export function buildEdgeNodePickIds(
  sourceVertexIndices: Uint32Array,
  sourceNodePickIds: Uint32Array | undefined,
): Uint32Array {
  const nodePickIds = new Uint32Array(sourceVertexIndices.length);
  for (let endpoint = 0; endpoint < sourceVertexIndices.length; endpoint += 1) {
    nodePickIds[endpoint] = sourceNodePickIds?.[sourceVertexIndices[endpoint] ?? 0] ?? 0;
  }
  return nodePickIds;
}

/**
 * Expands indexed line/triangle corners into renderer-owned draw vertices.
 * The uploaded index order is sequential, so vertex_index addresses one
 * expanded corner and primitiveIds retains its logical primitive identity.
 */
export function expandSurfaceGeometry(
  geometry: Exclude<Geometry, Extract<Geometry, { primitive: "points" }>>,
  sourceIndices: Uint32Array = geometry.indices,
): SurfaceVertexData {
  const verticesPerPrimitive = geometry.primitive === "triangles" ? 3 : 2;
  const positions = new Float32Array(sourceIndices.length * 3);
  const nodePickIds = new Uint32Array(sourceIndices.length);
  const primitiveIds = new Uint32Array(sourceIndices.length);
  const originalPrimitiveIds = primitiveIdsForSourceIndices(geometry, sourceIndices);
  for (let vertex = 0; vertex < sourceIndices.length; vertex += 1) {
    const sourceIndex = sourceIndices[vertex] ?? 0;
    const sourceOffset = sourceIndex * 3;
    positions.set(geometry.positions.subarray(sourceOffset, sourceOffset + 3), vertex * 3);
    nodePickIds[vertex] = geometry.nodePickIds?.[sourceIndex] ?? 0;
    primitiveIds[vertex] = originalPrimitiveIds[vertex - (vertex % verticesPerPrimitive)] ?? 0;
  }
  return {
    positions,
    indices: sequentialIndices(sourceIndices.length),
    nodePickIds,
    primitiveIds,
  };
}

function primitiveIdsForSourceIndices(
  geometry: Exclude<Geometry, Extract<Geometry, { primitive: "points" }>>,
  sourceIndices: Uint32Array,
): Uint32Array {
  const verticesPerPrimitive = geometry.primitive === "triangles" ? 3 : 2;
  if (sourceIndices === geometry.indices) {
    return Uint32Array.from({ length: sourceIndices.length }, (_, vertex) =>
      Math.floor(vertex / verticesPerPrimitive),
    );
  }
  if (geometry.primitive !== "triangles") {
    throw new Error("Only triangle subsets can use alternate surface indices");
  }
  const byTriangle = new Map<string, number>();
  for (let triangle = 0; triangle < geometry.indices.length / 3; triangle += 1) {
    const base = triangle * 3;
    byTriangle.set(triangleKey(geometry.indices, base), triangle);
  }
  const primitiveIds = new Uint32Array(sourceIndices.length);
  for (let triangle = 0; triangle < sourceIndices.length / 3; triangle += 1) {
    const primitiveId = byTriangle.get(triangleKey(sourceIndices, triangle * 3)) ?? 0;
    primitiveIds.fill(primitiveId, triangle * 3, triangle * 3 + 3);
  }
  return primitiveIds;
}

function triangleKey(indices: Uint32Array, base: number): string {
  return `${indices[base] ?? 0},${indices[base + 1] ?? 0},${indices[base + 2] ?? 0}`;
}

function sequentialIndices(count: number): Uint32Array {
  return Uint32Array.from({ length: count }, (_, index) => index);
}
