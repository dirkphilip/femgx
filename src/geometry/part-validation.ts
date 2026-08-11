import type { ElementId } from "../elements/element";
import type { Body, BodyId, ElementTessellation, FaceId, Geometry } from "./part";

/** Machine-readable geometry validation failure. */
export type GeometryValidationCode =
  | "invalid-body-id"
  | "duplicate-body-id"
  | "body-order"
  | "duplicate-body-membership"
  | "unknown-body-element"
  | "unknown-element-body"
  | "body-membership-mismatch";

/** Typed validation error raised for invalid body metadata. */
export class GeometryValidationError extends Error {
  readonly code: GeometryValidationCode;

  constructor(code: GeometryValidationCode, message: string) {
    super(message);
    this.name = "GeometryValidationError";
    this.code = code;
  }
}

/**
 * Validates element descriptors against a primitive buffer. When elements are
 * declared, every logical primitive must be covered by exactly one element and
 * ids must be unique. Geometry without element descriptors always validates.
 */
export function validateElements(geometry: {
  readonly positions?: Float32Array;
  readonly indices: Uint32Array;
  readonly primitive?: "triangles" | "lines" | "points";
  readonly elements?: readonly ElementTessellation[];
}): void {
  const elements = geometry.elements;
  if (elements === undefined || elements.length === 0) return;
  const primitive = geometry.primitive ?? "triangles";
  const primitiveCount = logicalPrimitiveCount(geometry);
  const coverage = new Uint8Array(primitiveCount);
  const seenIds = new Set<ElementId>();
  for (const element of elements) {
    const range = primitiveRangeForElement(primitive, element);
    if (range === undefined) {
      throw new Error(`Element ${element.id} has no ${primitiveLabel(primitive)} range`);
    }
    if (range.count <= 0)
      throw new Error(`Element ${element.id} has no ${primitiveLabel(primitive)}`);
    if (seenIds.has(element.id)) {
      throw new Error(`Duplicate element id ${element.id}`);
    }
    seenIds.add(element.id);
    const end = range.start + range.count;
    if (range.start < 0 || end > primitiveCount) {
      throw new Error(
        primitive === "triangles"
          ? `Element ${element.id} is outside the index buffer`
          : `Element ${element.id} is outside the primitive buffer`,
      );
    }
    for (let primitiveIndex = range.start; primitiveIndex < end; primitiveIndex++) {
      if (coverage[primitiveIndex] === 1) {
        throw new Error(
          `${primitiveLabel(primitive)} ${primitiveIndex} belongs to more than one element`,
        );
      }
      coverage[primitiveIndex] = 1;
    }
  }
  for (let primitiveIndex = 0; primitiveIndex < primitiveCount; primitiveIndex++) {
    if (coverage[primitiveIndex] === 0) {
      throw new Error(
        `${capitalize(primitiveLabel(primitive))} ${primitiveIndex} is not covered by any element`,
      );
    }
  }
}

/** Returns the number of logical draw primitives in geometry. */
export function logicalPrimitiveCount(geometry: {
  readonly positions?: Float32Array;
  readonly indices: Uint32Array;
  readonly primitive?: "triangles" | "lines" | "points";
}): number {
  switch (geometry.primitive ?? "triangles") {
    case "triangles":
      return Math.floor(geometry.indices.length / 3);
    case "lines":
      return Math.floor(geometry.indices.length / 2);
    case "points":
      return Math.floor((geometry.positions?.length ?? 0) / 12);
  }
}

/** Resolves the range fields appropriate for the geometry's primitive kind. */
export function primitiveRangeForElement(
  primitive: "triangles" | "lines" | "points",
  element: ElementTessellation,
): { readonly start: number; readonly count: number } | undefined {
  if (primitive === "triangles") {
    if (element.triangleStart === undefined || element.triangleCount === undefined)
      return undefined;
    return { start: element.triangleStart, count: element.triangleCount };
  }
  if (element.primitiveStart === undefined || element.primitiveCount === undefined)
    return undefined;
  return { start: element.primitiveStart, count: element.primitiveCount };
}

function primitiveLabel(primitive: "triangles" | "lines" | "points"): string {
  switch (primitive) {
    case "triangles":
      return "triangles";
    case "lines":
      return "line segments";
    case "points":
      return "point sprites";
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Validates body metadata and its relationship to declared element
 * tessellations. Bodies and their memberships must be supplied in ascending
 * id order so the read-only representation is deterministic.
 */
export function validateBodies(geometry: {
  readonly elements?: readonly ElementTessellation[];
  readonly bodies?: readonly Body[];
}): void {
  const bodies = geometry.bodies;
  if (bodies === undefined || bodies.length === 0) {
    validateElementsWithoutBodies(geometry.elements ?? []);
    return;
  }
  const elementIds = new Set((geometry.elements ?? []).map((element) => element.id));
  const membership = collectBodyMembership(bodies, elementIds);
  validateElementMembership(geometry.elements ?? [], membership.declaredBodies, membership.ids);
}

function validateElementsWithoutBodies(elements: readonly ElementTessellation[]): void {
  for (const element of elements) {
    if (element.bodyId === undefined) continue;
    throw new GeometryValidationError(
      "unknown-element-body",
      `Element ${element.id} references body ${element.bodyId}, but no bodies are declared`,
    );
  }
}

function collectBodyMembership(
  bodies: readonly Body[],
  elementIds: ReadonlySet<ElementId>,
): {
  readonly declaredBodies: ReadonlySet<BodyId>;
  readonly ids: ReadonlyMap<ElementId, BodyId>;
} {
  const declaredBodies = new Set<BodyId>();
  const ids = new Map<ElementId, BodyId>();
  let previousBodyId: BodyId | undefined;
  for (const body of bodies) {
    validateBodyOrder(body, previousBodyId, declaredBodies);
    previousBodyId = body.id;
    declaredBodies.add(body.id);
    collectBodyElements(body, elementIds, ids);
  }
  return { declaredBodies, ids };
}

function validateBodyOrder(
  body: Body,
  previousBodyId: BodyId | undefined,
  declaredBodies: ReadonlySet<BodyId>,
): void {
  if (!Number.isInteger(body.id) || body.id < 0) {
    throw new GeometryValidationError(
      "invalid-body-id",
      `Body id ${body.id} must be a non-negative integer`,
    );
  }
  if (declaredBodies.has(body.id)) {
    throw new GeometryValidationError("duplicate-body-id", `Duplicate body id ${body.id}`);
  }
  if (previousBodyId !== undefined && body.id <= previousBodyId) {
    throw new GeometryValidationError(
      "body-order",
      `Body ids must be strictly ascending; ${body.id} follows ${previousBodyId}`,
    );
  }
}

function collectBodyElements(
  body: Body,
  elementIds: ReadonlySet<ElementId>,
  membership: Map<ElementId, BodyId>,
): void {
  let previousElementId: ElementId | undefined;
  for (const elementId of body.elementIds) {
    if (previousElementId !== undefined && elementId <= previousElementId) {
      throw new GeometryValidationError(
        "body-order",
        `Body ${body.id} element ids must be strictly ascending`,
      );
    }
    if (!elementIds.has(elementId)) {
      throw new GeometryValidationError(
        "unknown-body-element",
        `Body ${body.id} references unknown element ${elementId}`,
      );
    }
    if (membership.has(elementId)) {
      throw new GeometryValidationError(
        "duplicate-body-membership",
        `Element ${elementId} belongs to more than one body`,
      );
    }
    membership.set(elementId, body.id);
    previousElementId = elementId;
  }
}

function validateElementMembership(
  elements: readonly ElementTessellation[],
  declaredBodies: ReadonlySet<BodyId>,
  membership: ReadonlyMap<ElementId, BodyId>,
): void {
  for (const element of elements) {
    const listedBodyId = membership.get(element.id);
    if (element.bodyId !== undefined && !declaredBodies.has(element.bodyId)) {
      throw new GeometryValidationError(
        "unknown-element-body",
        `Element ${element.id} references unknown body ${element.bodyId}`,
      );
    }
    if (
      listedBodyId !== element.bodyId &&
      (listedBodyId !== undefined || element.bodyId !== undefined)
    ) {
      throw new GeometryValidationError(
        "body-membership-mismatch",
        `Element ${element.id} body membership does not match its body metadata`,
      );
    }
  }
}

/** Returns the body id associated with an element, if any. */
export function bodyIdForElement(
  geometry: Pick<Geometry, "elements" | "bodies">,
  elementId: ElementId,
): BodyId | undefined {
  const element = geometry.elements?.find((candidate) => candidate.id === elementId);
  if (element?.bodyId !== undefined) return element.bodyId;
  return geometry.bodies?.find((body) => body.elementIds.includes(elementId))?.id;
}

/**
 * Validates optional node/face pick-id arrays against vertex and triangle
 * counts and the declared face descriptors.
 */
export function validatePickIds(geometry: Geometry): void {
  const vertexCount = geometry.positions.length / 3;
  if (geometry.nodePickIds !== undefined && geometry.nodePickIds.length !== vertexCount) {
    throw new Error(
      `nodePickIds must have one entry per vertex (${vertexCount}), got ${geometry.nodePickIds.length}`,
    );
  }
  const triangleCount = Math.floor(geometry.indices.length / 3);
  if (geometry.facePickIds !== undefined && geometry.facePickIds.length !== triangleCount) {
    throw new Error(
      `facePickIds must have one entry per triangle (${triangleCount}), got ${geometry.facePickIds.length}`,
    );
  }
  validateNodePickIds(geometry);
  validateFaceMetadata(geometry);
  validateFaceSubset(geometry);
  if (geometry.faces !== undefined) {
    const seen = new Set<FaceId>();
    geometry.faces.forEach((face, index) => {
      if (face.id !== index) {
        throw new Error(`Face ${face.id} is not at its id index ${index}`);
      }
      if (seen.has(face.id)) {
        throw new Error(`Duplicate face id ${face.id}`);
      }
      seen.add(face.id);
    });
  }
  validateBodies(geometry);
}

/** Validates that a render-time face subset resolves to declared face ids. */
export function validateFaceSubset(geometry: Geometry): void {
  const subset = geometry.faceSubset;
  if (subset === undefined) return;
  if (geometry.primitive === "lines" || geometry.primitive === "points") {
    throw new Error("faceSubset is supported only by triangle geometry");
  }
  if (subset.faceIds.length === 0) return;
  const faces = geometry.faces;
  const facePickIds = geometry.facePickIds;
  if (faces === undefined || facePickIds === undefined) {
    throw new Error("faceSubset requires declared faces and facePickIds");
  }
  const seen = new Set<FaceId>();
  for (const faceId of subset.faceIds) {
    if (!Number.isInteger(faceId) || faceId < 0 || faceId >= faces.length) {
      throw new Error(`faceSubset references undeclared face ${faceId}`);
    }
    if (seen.has(faceId)) throw new Error(`faceSubset repeats face ${faceId}`);
    if (!facePickIds.includes(faceId + 1)) {
      throw new Error(`faceSubset references face ${faceId} without triangles`);
    }
    seen.add(faceId);
  }
}

function validateNodePickIds(geometry: Geometry): void {
  const nodeCount =
    geometry.nodePositions === undefined ? undefined : geometry.nodePositions.length / 3;
  if (nodeCount !== undefined && !Number.isInteger(nodeCount)) {
    throw new Error("nodePositions length must be a multiple of 3");
  }
  for (const pickId of geometry.nodePickIds ?? []) {
    if (pickId === 0) continue;
    if (nodeCount !== undefined && pickId > nodeCount) {
      throw new Error(`nodePickIds references node ${pickId - 1} outside nodePositions`);
    }
  }
}

function validateFaceMetadata(geometry: Geometry): void {
  const faces = geometry.faces;
  const facePickIds = geometry.facePickIds;
  if (facePickIds !== undefined) {
    for (const pickId of facePickIds) {
      if (pickId === 0) continue;
      if (faces === undefined || pickId > faces.length) {
        throw new Error(`facePickIds references undeclared face ${pickId - 1}`);
      }
    }
  }
  if (faces === undefined) return;
  const elementIds =
    geometry.elements === undefined
      ? undefined
      : new Set(geometry.elements.map((element) => element.id));
  const nodeCount =
    geometry.nodePositions === undefined ? undefined : geometry.nodePositions.length / 3;
  for (const face of faces) {
    if (!Number.isInteger(face.elementId) || face.elementId < 0) {
      throw new Error(`Face ${face.id} has invalid element owner ${face.elementId}`);
    }
    if (elementIds !== undefined && !elementIds.has(face.elementId)) {
      throw new Error(`Face ${face.id} references undeclared element ${face.elementId}`);
    }
    validateFaceNodes(face.id, face.nodeIds, nodeCount);
    for (const neighbor of face.neighborElementIds) {
      if (!Number.isInteger(neighbor) || neighbor < 0) {
        throw new Error(`Face ${face.id} has invalid neighbor element ${neighbor}`);
      }
    }
  }
}

function validateFaceNodes(
  faceId: FaceId,
  nodeIds: readonly number[],
  nodeCount: number | undefined,
): void {
  for (const nodeId of nodeIds) {
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      throw new Error(`Face ${faceId} has invalid node reference ${nodeId}`);
    }
    if (nodeCount !== undefined && nodeId >= nodeCount) {
      throw new Error(`Face ${faceId} references node ${nodeId} outside nodePositions`);
    }
  }
}
