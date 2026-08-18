import { validateOneBasedId } from "../id-validation";
import type { Geometry, GeometryBody } from "../types";
import type { PackedSemanticStorage } from "./packed-semantic";
import { validatePackedBodies } from "./packed-validation-bodies";
import {
  markPackedCoverage,
  requirePackedCoverage,
  validatePackedRange,
} from "./packed-validation-ranges";

interface PackedPartBoundary {
  readonly geometries: readonly Geometry[];
  readonly semantic: PackedSemanticStorage;
  readonly nodePositions?: Float32Array;
  readonly bodies?: readonly GeometryBody[];
}

/** Validates packed authored columns at the same ownership boundary as createPart. */
export function validatePackedPartBoundary(input: PackedPartBoundary): void {
  const { semantic } = input;
  if (input.geometries.length === 0)
    throw new Error("Part must contain at least one geometry group");
  validateGroups(input.geometries, semantic.primitive);
  validateNodePositions(input.nodePositions);
  validateElements(input.geometries, semantic);
  validateFaces(input.geometries, semantic, input.nodePositions);
  const nodeCount = input.nodePositions === undefined ? undefined : input.nodePositions.length / 3;
  validateEdges(semantic, nodeCount);
  validatePickIds(input.geometries, semantic, input.nodePositions);
  const bodies = input.bodies ?? semantic.bodies;
  validatePackedBodies(semantic, bodies);
}

/** Adds a typed body column when callers supplied only body membership lists. */
export function normalizePackedBodyMembership(
  storage: PackedSemanticStorage,
  bodies: readonly GeometryBody[] | undefined,
): PackedSemanticStorage {
  const declared = bodies ?? storage.bodies;
  if (storage.elementBodyIds !== undefined || declared === undefined) return storage;
  const ids = new Uint32Array(storage.elementIds.length);
  const ordinals = new Map<number, number>();
  for (let ordinal = 0; ordinal < storage.elementIds.length; ordinal += 1) {
    const elementId = storage.elementIds[ordinal];
    if (elementId !== undefined) ordinals.set(elementId, ordinal);
  }
  for (const body of declared) {
    for (const elementId of body.elementIds) {
      const ordinal = ordinals.get(elementId);
      if (ordinal !== undefined) ids[ordinal] = body.id;
    }
  }
  return { ...storage, elementBodyIds: ids };
}

function validateGroups(
  geometries: readonly Geometry[],
  semanticPrimitive: Geometry["primitive"],
): void {
  const primitives = new Set<Geometry["primitive"]>();
  for (const geometry of geometries) {
    if (primitives.has(geometry.primitive)) {
      throw new Error(`Part cannot contain duplicate ${geometry.primitive} geometry groups`);
    }
    primitives.add(geometry.primitive);
    validateGeometry(geometry);
  }
  if (!primitives.has(semanticPrimitive)) {
    throw new Error(`Packed semantics reference missing ${semanticPrimitive} geometry group`);
  }
  if (primitives.size !== 1) {
    throw new Error("Packed semantics must define every geometry group or use one primitive group");
  }
}

function validateGeometry(geometry: Geometry): void {
  if (geometry.positions.length % 3 !== 0) {
    throw new Error("Geometry positions length must be a multiple of 3");
  }
  const vertices = geometry.positions.length / 3;
  for (const value of geometry.positions) {
    if (!Number.isFinite(value)) throw new Error("Geometry positions must be finite");
  }
  const width = geometry.primitive === "triangles" ? 3 : geometry.primitive === "lines" ? 2 : 1;
  if (geometry.indices.length % width !== 0) {
    throw new Error(
      `Geometry index count must be a multiple of ${width} for ${geometry.primitive}`,
    );
  }
  for (const index of geometry.indices) {
    if (index >= vertices) throw new Error(`Geometry index ${index} is outside positions`);
  }
}

function validateNodePositions(positions: Float32Array | undefined): void {
  if (positions === undefined) return;
  if (positions.length % 3 !== 0) throw new Error("nodePositions length must be a multiple of 3");
  for (const value of positions) {
    if (!Number.isFinite(value)) throw new Error("nodePositions must be finite");
  }
}

function validateElements(geometries: readonly Geometry[], storage: PackedSemanticStorage): void {
  const count = storage.elementIds.length;
  if (
    storage.elementPrimitiveStarts.length !== count ||
    storage.elementPrimitiveCounts.length !== count
  ) {
    throw new Error("Packed element columns must have equal lengths");
  }
  const ids = new Set<number>();
  const coverage = new Uint8Array(logicalPrimitiveCount(geometries, storage.primitive));
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const id = storage.elementIds[ordinal] ?? 0;
    validateOneBasedId(id, "Element");
    if (ids.has(id)) throw new Error(`Duplicate element id ${id}`);
    ids.add(id);
    const start = storage.elementPrimitiveStarts[ordinal] ?? 0;
    const size = storage.elementPrimitiveCounts[ordinal] ?? 0;
    validatePackedRange(`Element ${id}`, start, size, coverage.length);
    markPackedCoverage(coverage, start, size, `Primitive ${start}`);
  }
  if (storage.elementBodyIds !== undefined && storage.elementBodyIds.length !== count) {
    throw new Error("elementBodyIds must match element count");
  }
  if (storage.elementShapes !== undefined && storage.elementShapes.length !== count) {
    throw new Error("elementShapes must match element count");
  }
  validateElementIdOrder(storage);
  requirePackedCoverage(coverage, "primitive");
  validateElementFaces(storage, count);
}

function validateElementFaces(storage: PackedSemanticStorage, elementCount: number): void {
  const offsets = storage.elementFaceOffsets;
  if (offsets === undefined) {
    if (storage.faceOwnerElementOrdinals.length !== 0) {
      throw new Error("elementFaceOffsets are required when packed faces are present");
    }
    return;
  }
  if (offsets.length !== elementCount + 1) {
    throw new Error("elementFaceOffsets must have element count + 1 entries");
  }
  if ((offsets[0] ?? 0) !== 0) throw new Error("elementFaceOffsets must start at zero");
  for (let ordinal = 0; ordinal < elementCount; ordinal += 1) {
    if ((offsets[ordinal] ?? 0) > (offsets[ordinal + 1] ?? 0)) {
      throw new Error("elementFaceOffsets must be monotonic");
    }
    for (let face = offsets[ordinal] ?? 0; face < (offsets[ordinal + 1] ?? 0); face += 1) {
      if ((storage.faceOwnerElementOrdinals[face] ?? 0) !== ordinal) {
        throw new Error("faceOwnerElementOrdinals must match elementFaceOffsets grouping");
      }
    }
  }
  if ((offsets[elementCount] ?? 0) !== storage.faceOwnerElementOrdinals.length) {
    throw new Error("elementFaceOffsets must cover every face");
  }
}

function validateElementIdOrder(storage: PackedSemanticStorage): void {
  if (storage.elementIdsOneBasedContiguous === true) {
    for (let ordinal = 0; ordinal < storage.elementIds.length; ordinal += 1) {
      if (storage.elementIds[ordinal] !== ordinal + 1) {
        throw new Error("elementIdsOneBasedContiguous does not match element ids");
      }
    }
  }
  const ordinals = storage.elementIdOrdinalsSorted;
  if (ordinals === undefined) return;
  if (ordinals.length !== storage.elementIds.length) {
    throw new Error("elementIdOrdinalsSorted must match element count");
  }
  let previous = -1;
  const seen = new Set<number>();
  for (const ordinal of ordinals) {
    if (ordinal >= storage.elementIds.length || seen.has(ordinal)) {
      throw new Error("elementIdOrdinalsSorted contains an invalid ordinal");
    }
    const id = storage.elementIds[ordinal] ?? 0;
    if (id <= previous) throw new Error("elementIdOrdinalsSorted must be sorted by element id");
    previous = id;
    seen.add(ordinal);
  }
}

function validateFaces(
  geometries: readonly Geometry[],
  storage: PackedSemanticStorage,
  nodePositions: Float32Array | undefined,
): void {
  const faceCount = storage.faceOwnerElementOrdinals.length;
  const columns = [
    storage.faceIndices,
    storage.facePrimitiveStarts,
    storage.facePrimitiveCounts,
    storage.faceNeighborElementOrdinals,
  ];
  if (columns.some((column) => column.length !== faceCount)) {
    throw new Error("Packed face columns must have equal lengths");
  }
  if (storage.faceNodeOffsets.length !== faceCount + 1) {
    throw new Error("faceNodeOffsets must have face count + 1 entries");
  }
  if (
    storage.faceNodeOffsets[0] !== 0 ||
    storage.faceNodeOffsets[faceCount] !== storage.faceNodeIds.length
  ) {
    throw new Error("faceNodeOffsets must cover face nodes");
  }
  const triangleCount = logicalPrimitiveCount(geometries, "triangles");
  const coverage = new Uint8Array(triangleCount);
  validateFaceIndicesByElement(storage);
  for (let face = 0; face < faceCount; face += 1) {
    const owner = storage.faceOwnerElementOrdinals[face] ?? 0;
    if (owner >= storage.elementIds.length) throw new Error(`Face ${face} has unknown owner`);
    const faceIndex = storage.faceIndices[face] ?? 0;
    const start = storage.facePrimitiveStarts[face] ?? 0;
    const size = storage.facePrimitiveCounts[face] ?? 0;
    validatePackedRange(`Face ${face}`, start, size, triangleCount);
    validateFaceOwnership(storage, owner, start, size, faceIndex);
    markPackedCoverage(coverage, start, size, `Triangle ${start}`);
    validateFaceNodes(
      storage,
      face,
      nodePositions?.length === undefined ? undefined : nodePositions.length / 3,
    );
    const neighbor = storage.faceNeighborElementOrdinals[face] ?? 0;
    if (neighbor > storage.elementIds.length) throw new Error(`Face ${face} has unknown neighbor`);
    if (neighbor !== 0 && neighbor - 1 === owner) throw new Error(`Face ${face} neighbors itself`);
  }
  requirePackedCoverage(coverage, "triangle");
  validateSubset(storage, faceCount);
}

function validateFaceIndicesByElement(storage: PackedSemanticStorage): void {
  const offsets = storage.elementFaceOffsets;
  if (offsets === undefined) return;
  const seen = new Set<number>();
  for (let element = 0; element + 1 < offsets.length; element += 1) {
    seen.clear();
    const first = offsets[element] ?? 0;
    const last = offsets[element + 1] ?? first;
    for (let face = first; face < last; face += 1) {
      const index = storage.faceIndices[face] ?? 0;
      if (seen.has(index)) {
        const id = storage.elementIds[element] ?? 0;
        throw new Error(`Duplicate oriented face ${id}/${index}`);
      }
      seen.add(index);
    }
  }
}

function validateFaceOwnership(
  storage: PackedSemanticStorage,
  owner: number,
  start: number,
  size: number,
  faceIndex: number,
): void {
  const elementStart = storage.elementPrimitiveStarts[owner] ?? 0;
  const elementEnd = elementStart + (storage.elementPrimitiveCounts[owner] ?? 0);
  if (start < elementStart || start + size > elementEnd) {
    const id = storage.elementIds[owner] ?? 0;
    throw new Error(`Face ${id}/${faceIndex} is outside its element range`);
  }
}

function validateFaceNodes(
  storage: PackedSemanticStorage,
  face: number,
  nodeCount: number | undefined,
): void {
  const start = storage.faceNodeOffsets[face] ?? 0;
  const end = storage.faceNodeOffsets[face + 1] ?? start;
  if (end < start || end > storage.faceNodeIds.length || end - start < 3) {
    throw new Error(`Face ${face} has invalid node range`);
  }
  for (let index = start; index < end; index += 1) {
    const nodeId = storage.faceNodeIds[index] ?? 0;
    if (nodeCount !== undefined && nodeId >= nodeCount) {
      throw new Error(`Face ${face} references node ${nodeId} outside nodePositions`);
    }
  }
}

function validateSubset(storage: PackedSemanticStorage, faceCount: number): void {
  const seen = new Set<number>();
  for (const face of storage.faceSubsetOrdinals ?? []) {
    if (face >= faceCount) throw new Error(`faceSubset references undeclared face ${face}`);
    if (seen.has(face)) throw new Error(`faceSubset repeats face ${face}`);
    seen.add(face);
  }
}

function validateEdges(storage: PackedSemanticStorage, nodeCount: number | undefined): void {
  const offsets = storage.edgeNodeOffsets;
  const nodes = storage.edgeNodeIds;
  if (offsets === undefined && nodes === undefined) return;
  if (offsets === undefined || nodes === undefined || offsets.length === 0) {
    throw new Error("Packed edge node columns must be supplied together");
  }
  const edgeCount = offsets.length - 1;
  if (offsets[0] !== 0 || offsets[edgeCount] !== nodes.length) {
    throw new Error("edgeNodeOffsets must cover edge nodes");
  }
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const start = offsets[edge] ?? 0;
    const end = offsets[edge + 1] ?? start;
    for (let index = start; index < end; index += 1) {
      if (nodeCount !== undefined && (nodes[index] ?? 0) >= nodeCount) {
        throw new Error(`Edge ${edge} references a node outside nodePositions`);
      }
    }
    const size = end - start;
    if (size !== 2 && size !== 3) throw new Error(`Edge ${edge} must contain two or three nodes`);
  }
  validateReferences(
    storage,
    storage.edgeIncidentOffsets,
    storage.edgeIncidentElementOrdinals,
    "incident",
  );
  validateReferences(
    storage,
    storage.edgeFaceOffsets,
    storage.edgeFaceOwnerElementOrdinals,
    "face",
  );
  if (storage.edgeFaceOffsets !== undefined && storage.edgeFaceIndices === undefined) {
    throw new Error("edgeFaceIndices must accompany edgeFaceOffsets");
  }
  if (
    storage.edgeFaceIndices !== undefined &&
    storage.edgeFaceIndices.length !== (storage.edgeFaceOwnerElementOrdinals?.length ?? 0)
  ) {
    throw new Error("edgeFaceIndices must match edge face references");
  }
  if (storage.edgeFaceOwnerElementOrdinals !== undefined && storage.edgeFaceIndices !== undefined) {
    for (let reference = 0; reference < storage.edgeFaceIndices.length; reference += 1) {
      const owner = storage.edgeFaceOwnerElementOrdinals[reference] ?? 0;
      const faceIndex = storage.edgeFaceIndices[reference] ?? 0;
      if (!hasFace(storage, owner, faceIndex)) {
        throw new Error("Edge face reference does not identify a declared face");
      }
    }
  }
}

function validateReferences(
  storage: PackedSemanticStorage,
  offsets: Uint32Array | undefined,
  references: Uint32Array | undefined,
  label: string,
): void {
  if (offsets === undefined && references === undefined) return;
  if (offsets === undefined || references === undefined)
    throw new Error(`Packed edge ${label} columns are incomplete`);
  const edgeCount = (storage.edgeNodeOffsets?.length ?? 1) - 1;
  if (
    offsets.length !== edgeCount + 1 ||
    offsets[0] !== 0 ||
    offsets[edgeCount] !== references.length
  ) {
    throw new Error(`edge ${label} offsets do not cover references`);
  }
  for (let edge = 0; edge < edgeCount; edge += 1) {
    if ((offsets[edge] ?? 0) > (offsets[edge + 1] ?? 0)) {
      throw new Error(`edge ${label} offsets must be monotonic`);
    }
  }
  for (const ordinal of references) {
    if (ordinal >= storage.elementIds.length)
      throw new Error(`Edge ${label} references unknown element`);
  }
}

function hasFace(storage: PackedSemanticStorage, owner: number, faceIndex: number): boolean {
  const first = storage.elementFaceOffsets?.[owner] ?? 0;
  const last = storage.elementFaceOffsets?.[owner + 1] ?? 0;
  for (let face = first; face < last; face += 1) {
    if (storage.faceIndices[face] === faceIndex) return true;
  }
  return false;
}

function validatePickIds(
  geometries: readonly Geometry[],
  storage: PackedSemanticStorage,
  nodePositions: Float32Array | undefined,
): void {
  const nodeCount = nodePositions === undefined ? undefined : nodePositions.length / 3;
  for (const geometry of geometries) {
    if (
      geometry.nodePickIds !== undefined &&
      geometry.nodePickIds.length !== geometry.positions.length / 3
    ) {
      throw new Error("nodePickIds must have one entry per vertex");
    }
    for (const pickId of geometry.nodePickIds ?? []) {
      if (pickId !== 0 && nodeCount !== undefined && pickId > nodeCount) {
        throw new Error(`nodePickIds references node ${pickId - 1} outside nodePositions`);
      }
    }
  }
  if (storage.nodeCount !== (nodeCount ?? storage.nodeCount)) {
    throw new Error("Packed nodeCount must match nodePositions");
  }
}

function logicalPrimitiveCount(
  geometries: readonly Geometry[],
  primitive: Geometry["primitive"],
): number {
  const geometry = geometries.find((candidate) => candidate.primitive === primitive);
  if (geometry === undefined) return 0;
  const width = primitive === "triangles" ? 3 : primitive === "lines" ? 2 : 1;
  return geometry.indices.length / width;
}
