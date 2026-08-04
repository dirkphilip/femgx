import type { Geometry } from "../geometry/part";

/**
 * Builders for the per-triangle and per-vertex pick-id buffers uploaded with a
 * part's geometry. All ids are 1-based (`0` = none), mirroring the encoding of
 * the pick fragment shader and `pick-format.ts`.
 */

/** Builds the per-triangle element pick id map (`elementId + 1`, 0 = none). */
export function buildElementTrianglePickIds(geometry: Geometry): Uint32Array {
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const pickIds = new Uint32Array(triangleCount);
  for (const element of geometry.elements ?? []) {
    const end = element.triangleStart + element.triangleCount;
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      pickIds[triangle] = element.id + 1;
    }
  }
  return pickIds;
}

/** Builds the per-triangle face pick id map (`faceId + 1`, 0 = none). */
export function buildFaceTrianglePickIds(geometry: Geometry): Uint32Array {
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const pickIds = new Uint32Array(triangleCount);
  if (geometry.facePickIds !== undefined) {
    pickIds.set(geometry.facePickIds.subarray(0, triangleCount));
  }
  return pickIds;
}

/** Builds the per-vertex node pick id map (`nodeId + 1`, 0 = interpolated). */
export function buildVertexNodePickIds(geometry: Geometry): Uint32Array {
  const vertexCount = geometry.positions.length / 3;
  if (geometry.nodePickIds === undefined) return new Uint32Array(vertexCount);
  return geometry.nodePickIds;
}

/**
 * Builds the per-vertex corner-position buffer read by the node-pick vertex
 * stage. Only triangle parts are node-pickable; other parts get a single
 * element buffer whose out-of-bounds reads return zero.
 */
export function buildCornerPositions(geometry: Geometry): Float32Array {
  const triangleCount = Math.floor(geometry.indices.length / 3);
  if (triangleCount === 0) return new Float32Array(3);
  return geometry.positions;
}
