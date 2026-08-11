import { bodyIdForElement, type Geometry } from "../geometry/part";

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

/** Builds the per-triangle body pick id map (`bodyId + 1`, 0 = ungrouped). */
export function buildBodyTrianglePickIds(geometry: Geometry): Uint32Array {
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const pickIds = new Uint32Array(triangleCount);
  for (const element of geometry.elements ?? []) {
    const bodyId = bodyIdForElement(geometry, element.id);
    if (bodyId === undefined) continue;
    const end = element.triangleStart + element.triangleCount;
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      pickIds[triangle] = bodyId + 1;
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

/** Builds interleaved per-triangle face/body pick ids for one storage binding. */
export function buildTriangleFaceBodyPickData(geometry: Geometry): Uint32Array {
  const facePickIds = buildFaceTrianglePickIds(geometry);
  const bodyPickIds = buildBodyTrianglePickIds(geometry);
  const data = new Uint32Array(facePickIds.length * 2);
  for (let triangle = 0; triangle < facePickIds.length; triangle += 1) {
    data[triangle * 2] = facePickIds[triangle] ?? 0;
    data[triangle * 2 + 1] = bodyPickIds[triangle] ?? 0;
  }
  return data;
}

/** Builds one face/body pair per authored node sprite for the node passes. */
export function buildNodeBodyPickData(geometry: Geometry): Uint32Array {
  const nodeCount = (geometry.nodePositions?.length ?? 0) / 3;
  const nodeBodies = new Map<number, number | null>();
  for (const element of geometry.elements ?? []) {
    const bodyId = bodyIdForElement(geometry, element.id);
    const start = element.triangleStart * 3;
    const end = (element.triangleStart + element.triangleCount) * 3;
    for (let vertex = start; vertex < end; vertex += 1) {
      const pickId = geometry.nodePickIds?.[vertex] ?? 0;
      if (pickId === 0) continue;
      const nodeId = pickId - 1;
      const previous = nodeBodies.get(nodeId);
      if (bodyId === undefined || (previous !== undefined && previous !== bodyId)) {
        nodeBodies.set(nodeId, null);
      } else {
        nodeBodies.set(nodeId, bodyId);
      }
    }
  }
  // The shared binding is array<vec2<u32>>, whose minimum valid storage
  // binding is one complete 8-byte pair even when this part has no nodes.
  const data = new Uint32Array(Math.max(2, nodeCount * 2));
  for (const [nodeId, bodyId] of nodeBodies) {
    if (bodyId !== null) data[nodeId * 2 + 1] = bodyId + 1;
  }
  return data;
}

/** Builds the per-vertex node pick id map (`nodeId + 1`, 0 = interpolated). */
export function buildVertexNodePickIds(geometry: Geometry): Uint32Array {
  const vertexCount = geometry.positions.length / 3;
  if (geometry.nodePickIds === undefined) return new Uint32Array(vertexCount);
  return geometry.nodePickIds;
}
