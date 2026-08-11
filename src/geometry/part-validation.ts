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
 * Validates element descriptors against an index buffer. When elements are
 * declared, every triangle must be covered by exactly one element and ids must
 * be unique. Geometry without element descriptors always validates.
 */
export function validateElements(geometry: {
  readonly indices: Uint32Array;
  readonly elements?: readonly ElementTessellation[];
}): void {
  const elements = geometry.elements;
  if (elements === undefined || elements.length === 0) return;
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const coverage = new Uint8Array(triangleCount);
  const seenIds = new Set<ElementId>();
  for (const element of elements) {
    if (element.triangleCount <= 0) {
      throw new Error(`Element ${element.id} has no triangles`);
    }
    if (seenIds.has(element.id)) {
      throw new Error(`Duplicate element id ${element.id}`);
    }
    seenIds.add(element.id);
    const end = element.triangleStart + element.triangleCount;
    if (element.triangleStart < 0 || end > triangleCount) {
      throw new Error(`Element ${element.id} is outside the index buffer`);
    }
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      if (coverage[triangle] === 1) {
        throw new Error(`Triangle ${triangle} belongs to more than one element`);
      }
      coverage[triangle] = 1;
    }
  }
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (coverage[triangle] === 0) {
      throw new Error(`Triangle ${triangle} is not covered by any element`);
    }
  }
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
