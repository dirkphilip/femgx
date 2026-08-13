import type { FaceIdRef } from "../elements/faces";
import { validateOneBasedId } from "./id-validation";
import type { ElementTessellation, FaceTessellation, Geometry, TriangleGeometry } from "./types";

/** Validates that a render-time face subset resolves to declared face ranges. */
export function validateFaceSubset(geometry: Geometry): void {
  if (geometry.primitive !== "triangles") return;
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.faceIds.length === 0) return;
  const faces = geometry.faces;
  if (faces === undefined) throw new Error("faceSubset requires declared faces");
  const seen = new Set<string>();
  for (const ref of subset.faceIds) {
    const identity = faceIdentity(ref);
    if (seen.has(identity)) {
      throw new Error(`faceSubset repeats element ${ref.elementId} face ${ref.faceIndex}`);
    }
    const face = faces.find((candidate) => sameFace(candidate, ref));
    if (face === undefined || face.primitiveCount <= 0) {
      throw new Error(
        `faceSubset references undeclared element ${ref.elementId} face ${ref.faceIndex}`,
      );
    }
    seen.add(identity);
  }
}

/** Validates oriented face ranges, metadata, and their triangle coverage. */
export function validateFaceMetadata(geometry: Geometry): void {
  if (geometry.primitive !== "triangles" || geometry.faces === undefined) return;
  const elementIds =
    geometry.elements === undefined
      ? undefined
      : new Set(geometry.elements.map((element) => element.id));
  const elements = new Map((geometry.elements ?? []).map((element) => [element.id, element]));
  const coverage = new Uint8Array(geometry.indices.length / 3);
  const identities = new Set<string>();
  const nodeCount =
    geometry.nodePositions === undefined ? undefined : geometry.nodePositions.length / 3;
  for (const face of geometry.faces) {
    validateOneBasedId(face.elementId, "Face element owner");
    if (face.bodyId !== undefined) validateOneBasedId(face.bodyId, "Body");
    const element = elements.get(face.elementId);
    if (elementIds !== undefined && element === undefined) {
      throw new Error(`Face references undeclared element ${face.elementId}`);
    }
    const identity = faceIdentity(face);
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
    if (face.neighborElementIds.length > 1) {
      throw new Error(
        `Face ${identity} has ${face.neighborElementIds.length} neighbors; non-manifold faces are unsupported`,
      );
    }
    for (const neighbor of face.neighborElementIds) {
      validateOneBasedId(neighbor, "Face neighbor element");
      if (neighbor === face.elementId) {
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
    const elementEnd = element.primitiveStart + element.primitiveCount;
    if (face.primitiveStart < element.primitiveStart || end > elementEnd) {
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

function faceIdentity(face: FaceIdRef): string {
  return `${face.elementId}/${face.faceIndex}`;
}

function sameFace(face: FaceTessellation, ref: FaceIdRef): boolean {
  return face.elementId === ref.elementId && face.faceIndex === ref.faceIndex;
}
