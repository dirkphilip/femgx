import {
  logicalPrimitiveCount,
  type ElementTessellation,
  type Geometry,
} from "../../geometry/part";
import {
  packedSemanticStorageForGeometry,
  type PackedSemanticStorage,
} from "../../geometry/packed/packed-semantic";

/**
 * Builders for the per-primitive and per-vertex pick-id buffers uploaded with a
 * part's geometry. All ids are 1-based (`0` = none), mirroring the encoding of
 * the pick fragment shader and `pick-format.ts`.
 */

/** Builds the per-primitive element pick id map (`elementId + 1`, 0 = none). */
export function buildElementPrimitivePickIds(
  geometry: Geometry,
  elements: readonly ElementTessellation[] = [],
): Uint32Array {
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed !== undefined) {
    return buildPackedPrimitiveMetadata(geometry, packed, (ordinal) => {
      const elementId = packed.elementIds[ordinal];
      return elementId === undefined ? undefined : elementId + 1;
    });
  }
  return buildElementPrimitiveMetadata(geometry, elements, (element) => element.id + 1);
}

/** Builds the per-primitive private part-wide dense element ordinal map. */
export function buildElementPrimitiveOrdinals(
  geometry: Geometry,
  elements: readonly ElementTessellation[],
  elementOrdinalById: { get(key: number): number | undefined },
): Uint32Array {
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed !== undefined) {
    return buildPackedPrimitiveMetadata(geometry, packed, (ordinal) => ordinal + 1);
  }
  return buildElementPrimitiveMetadata(geometry, elements, (element) =>
    elementOrdinalById.get(element.id),
  );
}

/** Builds the per-primitive body pick id map (`bodyId + 1`, 0 = ungrouped). */
export function buildBodyPrimitivePickIds(
  geometry: Geometry,
  elements: readonly ElementTessellation[] = [],
): Uint32Array {
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed !== undefined) {
    return buildPackedPrimitiveMetadata(geometry, packed, (ordinal) => {
      const bodyId = packed.elementBodyIds?.[ordinal] ?? 0;
      return bodyId === 0 ? undefined : bodyId + 1;
    });
  }
  return buildElementPrimitiveMetadata(geometry, elements, (element) =>
    element.bodyId === undefined ? undefined : element.bodyId + 1,
  );
}

function buildPackedPrimitiveMetadata(
  geometry: Geometry,
  packed: PackedSemanticStorage,
  resolveValue: (ordinal: number) => number | undefined,
): Uint32Array {
  const metadata = new Uint32Array(logicalPrimitiveCount(geometry));
  for (let ordinal = 0; ordinal < packed.elementIds.length; ordinal += 1) {
    const value = resolveValue(ordinal);
    if (value === undefined) continue;
    const start = packed.elementPrimitiveStarts[ordinal] ?? 0;
    const end = start + (packed.elementPrimitiveCounts[ordinal] ?? 0);
    for (let primitive = start; primitive < end; primitive += 1) metadata[primitive] = value;
  }
  return metadata;
}

function buildElementPrimitiveMetadata(
  geometry: Geometry,
  elements: readonly ElementTessellation[],
  resolveValue: (element: ElementTessellation) => number | undefined,
): Uint32Array {
  const metadata = new Uint32Array(logicalPrimitiveCount(geometry));
  for (const element of elements) {
    const value = resolveValue(element);
    if (value === undefined) continue;
    for (const range of element.primitiveRanges) {
      if (range.primitive !== geometry.primitive) continue;
      const end = range.primitiveStart + range.primitiveCount;
      for (let primitiveIndex = range.primitiveStart; primitiveIndex < end; primitiveIndex++) {
        metadata[primitiveIndex] = value;
      }
    }
  }
  return metadata;
}

/** Builds the per-triangle face pick id map (`faceId + 1`, 0 = none). */
export function buildFacePrimitivePickIds(geometry: Geometry): Uint32Array {
  const primitiveCount = logicalPrimitiveCount(geometry);
  const pickIds = new Uint32Array(primitiveCount);
  if (geometry.primitive !== "triangles") return pickIds;
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed !== undefined) {
    for (let face = 0; face < packed.facePrimitiveStarts.length; face += 1) {
      const start = packed.facePrimitiveStarts[face] ?? 0;
      const end = start + (packed.facePrimitiveCounts[face] ?? 0);
      for (let primitive = start; primitive < end; primitive += 1) pickIds[primitive] = face + 1;
    }
    return pickIds;
  }
  for (let face = 0; face < (geometry.faces?.length ?? 0); face += 1) {
    const range = geometry.faces?.[face];
    if (range === undefined) continue;
    const end = range.primitiveStart + range.primitiveCount;
    for (let primitive = range.primitiveStart; primitive < end; primitive += 1) {
      pickIds[primitive] = face + 1;
    }
  }
  return pickIds;
}

export type TriangleOwnerPair = readonly [number, number, number, number];

/** Builds body and element owner/neighbor ids for each source triangle. */
export function buildTriangleOwnerPairs(
  geometry: Geometry,
  elements: readonly ElementTessellation[] = [],
  facePickIds = buildFacePrimitivePickIds(geometry),
): TriangleOwnerPair[] {
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed !== undefined) return buildPackedTriangleOwnerPairs(packed, facePickIds);
  const bodyPickIds = buildBodyPrimitivePickIds(geometry, elements);
  const elementPickIds = buildElementPrimitivePickIds(geometry, elements);
  const bodyByElement = new Map(elements.map((element) => [element.id, element.bodyId] as const));
  return Array.from(facePickIds, (facePickId, triangle): TriangleOwnerPair => {
    const owner = bodyPickIds[triangle] ?? 0;
    const element = elementPickIds[triangle] ?? 0;
    const face = geometry.primitive === "triangles" ? geometry.faces?.[facePickId - 1] : undefined;
    const neighborElementId = face?.neighborElementId;
    const neighborBody =
      neighborElementId === undefined ? undefined : bodyByElement.get(neighborElementId);
    const neighborPickId = neighborBody === undefined ? 0 : neighborBody + 1;
    const neighborElementPickId = neighborElementId === undefined ? 0 : neighborElementId + 1;
    return [owner, neighborPickId === owner ? 0 : neighborPickId, element, neighborElementPickId];
  });
}

function buildPackedTriangleOwnerPairs(
  packed: PackedSemanticStorage,
  facePickIds: Uint32Array,
): TriangleOwnerPair[] {
  const bodyByElement = packed.elementBodyIds;
  return Array.from(facePickIds, (facePickId): TriangleOwnerPair => {
    const faceOrdinal = facePickId - 1;
    if (faceOrdinal < 0 || faceOrdinal >= packed.faceOwnerElementOrdinals.length) {
      return [0, 0, 0, 0];
    }
    const ownerOrdinal = packed.faceOwnerElementOrdinals[faceOrdinal] ?? 0;
    const ownerElementId = packed.elementIds[ownerOrdinal] ?? 0;
    const ownerBodyId = bodyByElement?.[ownerOrdinal] ?? 0;
    const neighborOrdinal = packed.faceNeighborElementOrdinals[faceOrdinal] ?? 0;
    const neighborElementId =
      neighborOrdinal === 0 ? 0 : (packed.elementIds[neighborOrdinal - 1] ?? 0);
    const neighborBodyId = neighborOrdinal === 0 ? 0 : (bodyByElement?.[neighborOrdinal - 1] ?? 0);
    const ownerPickId = ownerBodyId === 0 ? 0 : ownerBodyId + 1;
    const neighborPickId =
      neighborBodyId === 0 || neighborBodyId === ownerBodyId ? 0 : neighborBodyId + 1;
    const neighborElementPickId = neighborElementId === 0 ? 0 : neighborElementId + 1;
    return [ownerPickId, neighborPickId, ownerElementId + 1, neighborElementPickId];
  });
}

/** Builds interleaved per-triangle face/owner/neighbor ids for one storage binding. */
export function buildPrimitiveFaceBodyPickData(
  geometry: Geometry,
  elements: readonly ElementTessellation[] = [],
): Uint32Array {
  const facePickIds = buildFacePrimitivePickIds(geometry);
  const ownerPairs = buildTriangleOwnerPairs(geometry, elements, facePickIds);
  const stride = 5;
  const data = new Uint32Array(ownerPairs.length * stride);
  for (let triangle = 0; triangle < ownerPairs.length; triangle += 1) {
    const facePickId = facePickIds[triangle] ?? 0;
    const [owner, neighbor, element, neighborElement] = ownerPairs[triangle] ?? [0, 0, 0, 0];
    const base = triangle * stride;
    data[base] = facePickId;
    data[base + 1] = owner;
    data[base + 2] = neighbor;
    data[base + 3] = element;
    data[base + 4] = neighborElement;
  }
  return data;
}
