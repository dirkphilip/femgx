import { validateOneBasedId } from "./id-validation";
import { faceIdentity } from "./element-face-selection";
import { packedSemanticStorageForGeometry } from "./packed/packed-semantic";
import type { ElementTessellation, FaceTessellation, Geometry, TriangleGeometry } from "./types";

const faceSubsetMasks = new WeakMap<TriangleGeometry, Uint8Array>();

/** Returns the cached displayed-primitive mask for a geometry's face subset. */
export function faceSubsetPrimitiveMask(geometry: TriangleGeometry): Uint8Array | undefined {
  const subset = geometry.faceSubset;
  if (subset === undefined) return undefined;
  const cached = faceSubsetMasks.get(geometry);
  if (cached !== undefined) return cached;
  const packed = packedSemanticStorageForGeometry(geometry);
  if (packed !== undefined && packed.faceSubsetOrdinals !== undefined) {
    const displayedByPrimitive = new Uint8Array(Math.floor(geometry.indices.length / 3));
    for (const faceOrdinal of packed.faceSubsetOrdinals) {
      const start = packed.facePrimitiveStarts[faceOrdinal] ?? 0;
      const end = start + (packed.facePrimitiveCounts[faceOrdinal] ?? 0);
      for (let primitive = start; primitive < end; primitive += 1) {
        displayedByPrimitive[primitive] = 1;
      }
    }
    faceSubsetMasks.set(geometry, displayedByPrimitive);
    return displayedByPrimitive;
  }
  const identities = new Set<string>();
  for (const ref of subset.faceIds) {
    const identity = faceIdentity(ref.elementId, ref.faceIndex);
    if (identities.has(identity)) {
      throw new Error(`faceSubset repeats element ${ref.elementId} face ${ref.faceIndex}`);
    }
    identities.add(identity);
  }
  const displayedByPrimitive = new Uint8Array(Math.floor(geometry.indices.length / 3));
  for (const face of geometry.faces ?? []) {
    const identity = faceIdentity(face.elementId, face.faceIndex);
    if (!identities.has(identity)) continue;
    const end = face.primitiveStart + face.primitiveCount;
    for (let primitive = face.primitiveStart; primitive < end; primitive += 1) {
      displayedByPrimitive[primitive] = 1;
    }
  }
  faceSubsetMasks.set(geometry, displayedByPrimitive);
  return displayedByPrimitive;
}

/** Validates that a render-time face subset resolves to declared face ranges. */
export function validateFaceSubset(geometry: Geometry): void {
  if (geometry.primitive !== "triangles") return;
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.faceIds.length === 0) return;
  const faces = geometry.faces;
  if (faces === undefined) throw new Error("faceSubset requires declared faces");
  const facesByIdentity = new Map(
    faces.map((face) => [faceIdentity(face.elementId, face.faceIndex), face] as const),
  );
  // Primitive lookup is render-time state; do not materialize it during validation.
  const identities = new Set<string>();
  for (const ref of subset.faceIds) {
    const identity = faceIdentity(ref.elementId, ref.faceIndex);
    if (identities.has(identity)) {
      throw new Error(`faceSubset repeats element ${ref.elementId} face ${ref.faceIndex}`);
    }
    identities.add(identity);
    const face = facesByIdentity.get(identity);
    if (face === undefined || face.primitiveCount <= 0) {
      throw new Error(
        `faceSubset references undeclared element ${ref.elementId} face ${ref.faceIndex}`,
      );
    }
  }
}

/** Validates oriented face ranges, metadata, and their triangle coverage. */
export function validateFaceMetadata(
  geometry: Geometry,
  elements: readonly ElementTessellation[] | undefined,
  nodePositions: Float32Array | undefined,
): void {
  if (geometry.primitive !== "triangles" || geometry.faces === undefined) return;
  const elementIds =
    elements === undefined ? undefined : new Set(elements.map((element) => element.id));
  const elementMap = new Map((elements ?? []).map((element) => [element.id, element]));
  const coverage = new Uint8Array(geometry.indices.length / 3);
  const identities = new Set<string>();
  const nodeCount = nodePositions === undefined ? undefined : nodePositions.length / 3;
  for (const face of geometry.faces) {
    validateOneBasedId(face.elementId, "Face element owner");
    if (face.bodyId !== undefined) validateOneBasedId(face.bodyId, "Body");
    const element = elementMap.get(face.elementId);
    if (elementIds !== undefined && element === undefined) {
      throw new Error(`Face references undeclared element ${face.elementId}`);
    }
    const identity = faceIdentity(face.elementId, face.faceIndex);
    if (identities.has(identity)) throw new Error(`Duplicate oriented face ${identity}`);
    identities.add(identity);
    validateFaceRange(face, geometry.indices.length / 3, element);
    const end = face.primitiveStart + face.primitiveCount;
    for (let primitive = face.primitiveStart; primitive < end; primitive += 1) {
      if (coverage[primitive] === 1) {
        throw new Error(`Triangle ${primitive} belongs to more than one face`);
      }
      coverage[primitive] = 1;
    }
    if (element !== undefined && face.bodyId !== element.bodyId) {
      throw new Error(
        `Face ${identity} body ${String(face.bodyId)} does not match element ${face.elementId} body ${String(element.bodyId)}`,
      );
    }
    validateFaceNodes(identity, face.nodeIds, nodeCount);
    if (face.neighborElementId !== undefined) {
      validateOneBasedId(face.neighborElementId, "Face neighbor element");
      if (face.neighborElementId === face.elementId) {
        throw new Error(`Face ${identity} cannot neighbor its owner element`);
      }
    }
  }
  for (let primitive = 0; primitive < coverage.length; primitive += 1) {
    if (coverage[primitive] === 0)
      throw new Error(`Triangle ${primitive} is not covered by a face`);
  }
}

function validateFaceRange(
  face: FaceTessellation,
  primitiveCount: number,
  element: ElementTessellation | undefined,
): void {
  if (
    !Number.isInteger(face.faceIndex) ||
    face.faceIndex < 0 ||
    !Number.isInteger(face.primitiveStart) ||
    face.primitiveStart < 0 ||
    !Number.isInteger(face.primitiveCount) ||
    face.primitiveCount <= 0
  ) {
    throw new Error(
      `Face ${face.elementId}/${face.faceIndex} must have a non-empty integer primitive range`,
    );
  }
  const end = face.primitiveStart + face.primitiveCount;
  if (end > primitiveCount) {
    throw new Error(`Face ${face.elementId}/${face.faceIndex} is outside the triangle buffer`);
  }
  if (element !== undefined) {
    const ownsFace = element.primitiveRanges.some(
      (range) =>
        range.primitive === "triangles" &&
        face.primitiveStart >= range.primitiveStart &&
        end <= range.primitiveStart + range.primitiveCount,
    );
    if (!ownsFace) {
      throw new Error(`Face ${face.elementId}/${face.faceIndex} is outside its element range`);
    }
  }
}

function validateFaceNodes(
  identity: string,
  nodeIds: readonly number[],
  nodeCount: number | undefined,
): void {
  for (const nodeId of nodeIds) {
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      throw new Error(`Face ${identity} has invalid node reference ${nodeId}`);
    }
    if (nodeCount !== undefined && nodeId >= nodeCount) {
      throw new Error(`Face ${identity} references node ${nodeId} outside nodePositions`);
    }
  }
}

/** Returns the oriented face owning one logical triangle, if face metadata exists. */
export function faceForPrimitive(
  geometry: TriangleGeometry,
  primitive: number,
): FaceTessellation | undefined {
  return geometry.faces?.find(
    (face) =>
      primitive >= face.primitiveStart && primitive < face.primitiveStart + face.primitiveCount,
  );
}
