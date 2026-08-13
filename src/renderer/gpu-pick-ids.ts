import {
  bodyIdForElement,
  logicalPrimitiveCount,
  primitiveRangeForElement,
  type Geometry,
} from "../geometry/part";

/**
 * Builders for the per-primitive and per-vertex pick-id buffers uploaded with a
 * part's geometry. All ids are 1-based (`0` = none), mirroring the encoding of
 * the pick fragment shader and `pick-format.ts`.
 */

/** Builds the per-primitive element pick id map (`elementId + 1`, 0 = none). */
export function buildElementPrimitivePickIds(geometry: Geometry): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  for (const element of geometry.elements ?? []) {
    const range = primitiveRangeForElement(element);
    const end = range.start + range.count;
    for (let primitiveIndex = range.start; primitiveIndex < end; primitiveIndex++) {
      pickIds[primitiveIndex] = element.id + 1;
    }
  }
  return pickIds;
}

/** Builds the per-primitive body pick id map (`bodyId + 1`, 0 = ungrouped). */
export function buildBodyPrimitivePickIds(geometry: Geometry): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  for (const element of geometry.elements ?? []) {
    const bodyId = bodyIdForElement(geometry, element.id);
    if (bodyId === undefined) continue;
    const range = primitiveRangeForElement(element);
    const end = range.start + range.count;
    for (let primitiveIndex = range.start; primitiveIndex < end; primitiveIndex++) {
      pickIds[primitiveIndex] = bodyId + 1;
    }
  }
  return pickIds;
}

/** Builds the per-triangle face pick id map (`faceId + 1`, 0 = none). */
export function buildFacePrimitivePickIds(geometry: Geometry): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  if (geometry.primitive === "triangles" && geometry.facePickIds !== undefined) {
    pickIds.set(geometry.facePickIds.subarray(0, primitiveCount));
  }
  return pickIds;
}

/** Builds interleaved per-triangle face/owner/neighbor ids for one storage binding. */
export function buildPrimitiveFaceBodyPickData(geometry: Geometry): Uint32Array {
  const facePickIds = buildFacePrimitivePickIds(geometry);
  const bodyPickIds = buildBodyPrimitivePickIds(geometry);
  const elementPickIds = buildElementPrimitivePickIds(geometry);
  const data = new Uint32Array(facePickIds.length * 5);
  for (let triangle = 0; triangle < facePickIds.length; triangle += 1) {
    const facePickId = facePickIds[triangle] ?? 0;
    const face = geometry.primitive === "triangles" ? geometry.faces?.[facePickId - 1] : undefined;
    const base = triangle * 5;
    data[base] = facePickId;
    data[base + 1] = bodyPickIds[triangle] ?? 0;
    const neighborElementId = face?.neighborElementIds[0];
    const neighborBody =
      neighborElementId === undefined ? undefined : bodyIdForElement(geometry, neighborElementId);
    data[base + 2] =
      neighborBody === undefined || neighborBody + 1 === data[base + 1] ? 0 : neighborBody + 1;
    data[base + 3] = elementPickIds[triangle] ?? 0;
    data[base + 4] = neighborElementId === undefined ? 0 : neighborElementId + 1;
  }
  return data;
}

/** Builds one face/owner/neighbor record per authored node sprite. */
export function buildNodeBodyPickData(
  geometry: Geometry,
  spritePickIds?: ArrayLike<number>,
): Uint32Array {
  const nodeCount = (geometry.nodePositions?.length ?? 0) / 3;
  const owners = nodeBodyOwners(geometry);
  // The shared binding is array<vec3<u32>>, whose minimum valid storage
  // is one complete 12-byte record even when this part has no nodes. Node
  // topology ownership remains an array of owner/neighbor pairs below.
  const sprites =
    spritePickIds ?? Uint32Array.from({ length: nodeCount }, (_, nodeId) => nodeId + 1);
  const data = new Uint32Array(Math.max(5, sprites.length * 5));
  const elementOwners = nodeElementOwners(geometry);
  for (let sprite = 0; sprite < sprites.length; sprite += 1) {
    const pickId = sprites[sprite] ?? 0;
    const bodyIds = owners.get(pickId - 1);
    const elements = elementOwners.get(pickId - 1);
    const base = sprite * 5;
    const bodyId = bodyIds?.size === 1 ? [...bodyIds][0] : undefined;
    const elementId = elements?.length === 1 ? elements[0]?.elementId : undefined;
    if (bodyId !== undefined) data[base + 1] = bodyId + 1;
    if (elementId !== undefined) data[base + 3] = elementId + 1;
  }
  return data;
}

/** Builds variable-length body-owner ranges for each authored node sprite. */
export function buildNodeBodyOwnerData(
  geometry: Geometry,
  spritePickIds: ArrayLike<number>,
): {
  readonly bodyRanges: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly elementIds: Uint32Array;
} {
  const elementOwners = nodeElementOwners(geometry);
  const bodyIds: number[] = [];
  const elementIds: number[] = [];
  const bodyRanges = new Uint32Array(spritePickIds.length * 2);
  for (let sprite = 0; sprite < spritePickIds.length; sprite += 1) {
    const pickId = spritePickIds[sprite] ?? 0;
    const ownerIds = [...(elementOwners.get(pickId - 1) ?? [])].sort(
      (a, b) => (a.bodyId ?? -1) - (b.bodyId ?? -1) || a.elementId - b.elementId,
    );
    bodyRanges[sprite * 2] = bodyIds.length / 2;
    bodyRanges[sprite * 2 + 1] = ownerIds.length;
    for (const { bodyId, elementId } of ownerIds) {
      bodyIds.push(bodyId === undefined ? 0 : bodyId + 1, 0);
      elementIds.push(elementId + 1, 0);
    }
  }
  return {
    bodyRanges: bodyRanges.length === 0 ? new Uint32Array([0, 0]) : bodyRanges,
    bodyIds: bodyIds.length === 0 ? new Uint32Array([0, 0]) : new Uint32Array(bodyIds),
    elementIds: elementIds.length === 0 ? new Uint32Array([0, 0]) : new Uint32Array(elementIds),
  };
}

interface NodeElementOwner {
  readonly bodyId: number | undefined;
  readonly elementId: number;
}

function nodeElementOwners(geometry: Geometry): Map<number, NodeElementOwner[]> {
  const owners = new Map<number, Map<string, NodeElementOwner>>();
  for (const element of geometry.elements ?? []) {
    const bodyId = bodyIdForElement(geometry, element.id);
    const range = primitiveRangeForElement(element);
    const verticesPerPrimitive =
      geometry.primitive === "lines" ? 2 : geometry.primitive === "points" ? 1 : 3;
    const start = range.start * verticesPerPrimitive;
    const end = (range.start + range.count) * verticesPerPrimitive;
    for (let vertex = start; vertex < end; vertex += 1) {
      const pickId = geometry.nodePickIds?.[vertex] ?? 0;
      if (pickId === 0) continue;
      const byElement = owners.get(pickId - 1) ?? new Map<string, NodeElementOwner>();
      byElement.set(`${bodyId ?? "unowned"}/${element.id}`, { bodyId, elementId: element.id });
      owners.set(pickId - 1, byElement);
    }
  }
  return new Map([...owners].map(([nodeId, values]) => [nodeId, [...values.values()]]));
}

function nodeBodyOwners(geometry: Geometry): Map<number, Set<number | undefined>> {
  const owners = new Map<number, Set<number | undefined>>();
  for (const element of geometry.elements ?? []) {
    const bodyId = bodyIdForElement(geometry, element.id);
    const range = primitiveRangeForElement(element);
    const verticesPerPrimitive =
      geometry.primitive === "lines" ? 2 : geometry.primitive === "points" ? 1 : 3;
    const start = range.start * verticesPerPrimitive;
    const end = (range.start + range.count) * verticesPerPrimitive;
    for (let vertex = start; vertex < end; vertex += 1) {
      const pickId = geometry.nodePickIds?.[vertex] ?? 0;
      if (pickId === 0) continue;
      const bodyIds = owners.get(pickId - 1) ?? new Set<number | undefined>();
      bodyIds.add(bodyId);
      owners.set(pickId - 1, bodyIds);
    }
  }
  return owners;
}

/** Builds deterministic, ascending 1-based ids for the node sprites a part uses. */
export function buildNodeSpritePickIds(geometry: Geometry): Uint32Array {
  const nodeCount = (geometry.nodePositions?.length ?? 0) / 3;
  const ids = new Set<number>();
  for (const pickId of geometry.nodePickIds ?? []) {
    if (pickId > 0 && pickId <= nodeCount) ids.add(pickId);
  }
  return Uint32Array.from([...ids].sort((a, b) => a - b));
}

/** Builds the per-vertex node pick id map (`nodeId + 1`, 0 = vertex without a node). */
export function buildVertexNodePickIds(geometry: {
  readonly positions: Float32Array;
  readonly nodePickIds?: Uint32Array | undefined;
}): Uint32Array {
  const vertexCount = geometry.positions.length / 3;
  if (geometry.nodePickIds === undefined) return new Uint32Array(vertexCount);
  return geometry.nodePickIds;
}
