import {
  logicalPrimitiveCount,
  type ElementTessellation,
  type Geometry,
} from "../../geometry/part";
import { geometrySemanticGraph } from "../../geometry/semantic/part-semantic-graph";

export type ElementTessellations = Iterable<ElementTessellation> & { readonly count?: number };

const noElements: ElementTessellations = {
  *[Symbol.iterator](): IterableIterator<ElementTessellation> {},
};

function elementCount(elements: ElementTessellations): number {
  return elements.count ?? (Array.isArray(elements) ? elements.length : 0);
}

/**
 * Builders for the per-primitive and per-vertex pick-id buffers uploaded with a
 * part's geometry. All ids are 1-based (`0` = none), mirroring the encoding of
 * the pick fragment shader and `pick-format.ts`.
 */

/** Builds the per-primitive element pick id map (`elementId + 1`, 0 = none). */
export function buildElementPrimitivePickIds(
  geometry: Geometry,
  elements: ElementTessellations = noElements,
): Uint32Array {
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    return buildGraphPrimitiveMetadata(geometry, semantic, (ordinal) => {
      const elementId = semantic.graph.elementIds[ordinal];
      return elementId === undefined ? undefined : elementId + 1;
    });
  }
  return buildElementPrimitiveMetadata(geometry, elements, (element) => element.id + 1);
}

/** Builds the per-primitive private part-wide dense element ordinal map. */
export function buildElementPrimitiveOrdinals(
  geometry: Geometry,
  elements: ElementTessellations,
  elementOrdinal: (elementId: number) => number | undefined,
): Uint32Array {
  const semantic = geometrySemanticGraph(geometry);
  if (
    semantic === undefined &&
    geometry.primitive === "triangles" &&
    geometry.primitiveColors !== undefined &&
    elementCount(elements) === 0
  ) {
    return Uint32Array.from({ length: logicalPrimitiveCount(geometry) }, (_, index) => index + 1);
  }
  if (semantic === undefined && elementCount(elements) === 0) return new Uint32Array();
  if (semantic !== undefined) {
    return buildGraphPrimitiveMetadata(geometry, semantic, (ordinal) => {
      const elementId = semantic.graph.elementIds[ordinal] ?? 0;
      return elementOrdinal(elementId);
    });
  }
  return buildElementPrimitiveMetadata(geometry, elements, (element) => elementOrdinal(element.id));
}

/** Builds the per-primitive body pick id map (`bodyId + 1`, 0 = ungrouped). */
export function buildBodyPrimitivePickIds(
  geometry: Geometry,
  elements: ElementTessellations = noElements,
): Uint32Array {
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    return buildGraphPrimitiveMetadata(geometry, semantic, (ordinal) => {
      const bodyId = semantic.graph.elementBodyIds[ordinal] ?? 0;
      return bodyId === 0 ? undefined : bodyId + 1;
    });
  }
  return buildElementPrimitiveMetadata(geometry, elements, (element) =>
    element.bodyId === undefined ? undefined : element.bodyId + 1,
  );
}

function buildGraphPrimitiveMetadata(
  geometry: Geometry,
  semantic: NonNullable<ReturnType<typeof geometrySemanticGraph>>,
  resolveValue: (ordinal: number) => number | undefined,
): Uint32Array {
  const metadata = new Uint32Array(logicalPrimitiveCount(geometry));
  const { graph, geometryOrdinal } = semantic;
  for (let ordinal = 0; ordinal < graph.elementIds.length; ordinal += 1) {
    const value = resolveValue(ordinal);
    if (value === undefined) continue;
    const firstRange = graph.elementRangeOffsets[ordinal] ?? 0;
    const lastRange = graph.elementRangeOffsets[ordinal + 1] ?? firstRange;
    for (let range = firstRange; range < lastRange; range += 1) {
      if (graph.elementRangeGeometryOrdinals[range] !== geometryOrdinal) continue;
      const start = graph.elementRangeStarts[range] ?? 0;
      const end = start + (graph.elementRangeCounts[range] ?? 0);
      for (let primitive = start; primitive < end; primitive += 1) metadata[primitive] = value;
    }
  }
  return metadata;
}

function buildElementPrimitiveMetadata(
  geometry: Geometry,
  elements: ElementTessellations,
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
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    const { graph, geometryOrdinal } = semantic;
    const first = graph.faceGeometryOffsets[geometryOrdinal] ?? 0;
    const last = graph.faceGeometryOffsets[geometryOrdinal + 1] ?? first;
    for (let face = first; face < last; face += 1) {
      const start = graph.facePrimitiveStarts[face] ?? 0;
      const end = start + (graph.facePrimitiveCounts[face] ?? 0);
      for (let primitive = start; primitive < end; primitive += 1)
        pickIds[primitive] = face - first + 1;
    }
    return pickIds;
  }
  for (let face = 0; face < (geometry.faces?.count ?? 0); face += 1) {
    const range = geometry.faces?.at(face);
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
  elements: ElementTessellations = noElements,
  facePickIds = buildFacePrimitivePickIds(geometry),
): TriangleOwnerPair[] {
  const semantic = geometrySemanticGraph(geometry);
  if (
    semantic !== undefined &&
    geometry.primitive === "triangles" &&
    (semantic.graph.faceGeometryOffsets[semantic.geometryOrdinal + 1] ?? 0) >
      (semantic.graph.faceGeometryOffsets[semantic.geometryOrdinal] ?? 0)
  ) {
    return buildGraphTriangleOwnerPairs(semantic, facePickIds);
  }
  const bodyPickIds = buildBodyPrimitivePickIds(geometry, elements);
  const elementPickIds = buildElementPrimitivePickIds(geometry, elements);
  const bodyByElement = new Map<number, number | undefined>();
  for (const element of elements) bodyByElement.set(element.id, element.bodyId);
  return Array.from(facePickIds, (facePickId, triangle): TriangleOwnerPair => {
    const owner = bodyPickIds[triangle] ?? 0;
    const element = elementPickIds[triangle] ?? 0;
    const face =
      geometry.primitive === "triangles" ? geometry.faces?.at(facePickId - 1) : undefined;
    const neighborElementId = face?.neighborElementId;
    const neighborBody =
      neighborElementId === undefined ? undefined : bodyByElement.get(neighborElementId);
    const neighborPickId = neighborBody === undefined ? 0 : neighborBody + 1;
    const neighborElementPickId = neighborElementId === undefined ? 0 : neighborElementId + 1;
    return [owner, neighborPickId === owner ? 0 : neighborPickId, element, neighborElementPickId];
  });
}

function buildGraphTriangleOwnerPairs(
  semantic: NonNullable<ReturnType<typeof geometrySemanticGraph>>,
  facePickIds: Uint32Array,
): TriangleOwnerPair[] {
  const { graph, geometryOrdinal } = semantic;
  const first = graph.faceGeometryOffsets[geometryOrdinal] ?? 0;
  const last = graph.faceGeometryOffsets[geometryOrdinal + 1] ?? first;
  return Array.from(facePickIds, (facePickId): TriangleOwnerPair => {
    const faceOrdinal = first + facePickId - 1;
    if (faceOrdinal < first || faceOrdinal >= last) {
      return [0, 0, 0, 0];
    }
    const ownerOrdinal = graph.faceOwnerElementOrdinals[faceOrdinal] ?? 0;
    const ownerElementId = graph.elementIds[ownerOrdinal] ?? 0;
    const ownerBodyId = graph.faceBodyIds[faceOrdinal] ?? graph.elementBodyIds[ownerOrdinal] ?? 0;
    const neighborOrdinal = graph.faceNeighborElementOrdinals[faceOrdinal] ?? 0;
    const neighborElementId =
      neighborOrdinal === 0 ? 0 : (graph.elementIds[neighborOrdinal - 1] ?? 0);
    const neighborBodyId =
      neighborOrdinal === 0 ? 0 : (graph.elementBodyIds[neighborOrdinal - 1] ?? 0);
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
  elements: ElementTessellations = noElements,
): Uint32Array {
  const graphOwner = geometrySemanticGraph(geometry);
  if (graphOwner !== undefined) return buildGraphPrimitiveFaceBodyPickData(geometry, graphOwner);
  if (
    geometry.primitive === "triangles" &&
    geometry.faces === undefined &&
    elementCount(elements) === 0
  ) {
    return new Uint32Array(logicalPrimitiveCount(geometry) * 5);
  }
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

function buildGraphPrimitiveFaceBodyPickData(
  geometry: Geometry,
  owner: NonNullable<ReturnType<typeof geometrySemanticGraph>>,
): Uint32Array {
  const data = new Uint32Array(logicalPrimitiveCount(geometry) * 5);
  if (geometry.primitive !== "triangles") return data;
  const { graph, geometryOrdinal } = owner;
  const first = graph.faceGeometryOffsets[geometryOrdinal] ?? 0;
  const last = graph.faceGeometryOffsets[geometryOrdinal + 1] ?? first;
  for (let face = first; face < last; face += 1) {
    const ownerOrdinal = graph.faceOwnerElementOrdinals[face] ?? 0;
    const ownerBody = graph.faceBodyIds[face] ?? graph.elementBodyIds[ownerOrdinal] ?? 0;
    const neighborOrdinal = graph.faceNeighborElementOrdinals[face] ?? 0;
    const neighborBody =
      neighborOrdinal === 0 ? 0 : (graph.elementBodyIds[neighborOrdinal - 1] ?? 0);
    const firstPrimitive = graph.facePrimitiveStarts[face] ?? 0;
    const lastPrimitive = firstPrimitive + (graph.facePrimitiveCounts[face] ?? 0);
    for (let primitive = firstPrimitive; primitive < lastPrimitive; primitive += 1) {
      const base = primitive * 5;
      data[base] = face - first + 1;
      data[base + 1] = ownerBody === 0 ? 0 : ownerBody + 1;
      data[base + 2] = neighborBody === 0 || neighborBody === ownerBody ? 0 : neighborBody + 1;
      data[base + 3] = (graph.elementIds[ownerOrdinal] ?? 0) + 1;
      data[base + 4] = neighborOrdinal === 0 ? 0 : (graph.elementIds[neighborOrdinal - 1] ?? 0) + 1;
    }
  }
  return data;
}
