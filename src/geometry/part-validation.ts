import type { ElementId } from "../elements/element";
import type { BodyId } from "../elements/model";
import type { ElementTessellation, Geometry, GeometryBody } from "./types";
import { MAX_ONE_BASED_ID, isValidOneBasedId, validateOneBasedId } from "./id-validation";
import { validateFaceMetadata, validateFaceSubset } from "./face-validation";
import { validateEdges } from "./edge-validation";
import { GeometryValidationError } from "./validation-error";

export { faceForPrimitive, validateFaceSubset } from "./face-validation";
export { GeometryValidationError, type GeometryValidationCode } from "./validation-error";

interface PartSemanticGeometry {
  readonly elements?: readonly Pick<ElementTessellation, "id" | "bodyId">[];
  readonly bodies?: readonly GeometryBody[];
}

/**
 * Validates element descriptors against a primitive buffer. When elements are
 * declared, every logical primitive must be covered by exactly one element and
 * ids must be unique. Geometry without element descriptors always validates.
 */
export function validateElements(
  geometry: {
    readonly positions?: Float32Array;
    readonly indices: Uint32Array;
    readonly primitive: "triangles" | "lines" | "points";
  },
  elements: readonly ElementTessellation[] | undefined,
): void {
  if (elements === undefined || elements.length === 0) return;
  const primitive = geometry.primitive;
  const primitiveCount = logicalPrimitiveCount(geometry);
  const coverage = new Uint8Array(primitiveCount);
  for (const element of elements) {
    validateOneBasedId(element.id, "Element");
    if (element.bodyId !== undefined) validateBodyId(element.bodyId);
    if (!element.primitiveRanges.some((range) => range.primitive === primitive)) continue;
    validateElementRanges(element, primitive, primitiveCount, coverage);
  }
  for (let primitiveIndex = 0; primitiveIndex < primitiveCount; primitiveIndex++) {
    if (coverage[primitiveIndex] === 0) {
      throw new Error(
        `${capitalize(primitiveLabel(primitive))} ${primitiveIndex} is not covered by any element`,
      );
    }
  }
}

function validateElementRanges(
  element: ElementTessellation,
  primitive: "triangles" | "lines" | "points",
  primitiveCount: number,
  coverage: Uint8Array,
): void {
  const ranges = element.primitiveRanges.filter((candidate) => candidate.primitive === primitive);
  if (ranges.length === 0)
    throw new Error(`Element ${element.id} has no ${primitiveLabel(primitive)}`);
  for (const range of ranges) {
    if (
      !Number.isInteger(range.primitiveStart) ||
      range.primitiveStart < 0 ||
      !Number.isInteger(range.primitiveCount) ||
      range.primitiveCount <= 0
    )
      throw new Error(`Element ${element.id} has no ${primitiveLabel(primitive)}`);
    const end = range.primitiveStart + range.primitiveCount;
    if (range.primitiveStart < 0 || end > primitiveCount) {
      throw new Error(
        primitive === "triangles"
          ? `Element ${element.id} is outside the index buffer`
          : `Element ${element.id} is outside the primitive buffer`,
      );
    }
    for (let primitiveIndex = range.primitiveStart; primitiveIndex < end; primitiveIndex++) {
      if (coverage[primitiveIndex] === 1) {
        throw new Error(
          `${primitiveLabel(primitive)} ${primitiveIndex} belongs to more than one element`,
        );
      }
      coverage[primitiveIndex] = 1;
    }
  }
}

/** Returns the number of logical draw primitives in geometry. */
export function logicalPrimitiveCount(geometry: {
  readonly positions?: Float32Array;
  readonly indices: Uint32Array;
  readonly primitive: "triangles" | "lines" | "points";
}): number {
  switch (geometry.primitive) {
    case "triangles":
      return Math.floor(geometry.indices.length / 3);
    case "lines":
      return Math.floor(geometry.indices.length / 2);
    case "points":
      return geometry.indices.length;
  }
}

/** Resolves the logical primitive ranges owned by an element in one geometry. */
export function primitiveRangesForElement(
  element: ElementTessellation,
  primitive: "triangles" | "lines" | "points",
): readonly { readonly start: number; readonly count: number }[] {
  return element.primitiveRanges
    .filter((range) => range.primitive === primitive)
    .map(({ primitiveStart: start, primitiveCount: count }) => ({ start, count }));
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
  readonly elements?: readonly Pick<ElementTessellation, "id" | "bodyId">[];
  readonly bodies?: readonly GeometryBody[];
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

/** Resolves body ownership once against a complete element list. */
export function bodyAssignments(
  elements: readonly Pick<ElementTessellation, "id">[],
  bodies: readonly GeometryBody[] | undefined,
): ReadonlyMap<ElementId, BodyId> {
  if (bodies === undefined || bodies.length === 0) return new Map();
  const assignments = new Map<ElementId, BodyId>();
  for (const body of bodies) {
    for (const elementId of body.elementIds) assignments.set(elementId, body.id);
  }
  validateBodies({
    elements: elements.map((element) => {
      const bodyId = assignments.get(element.id);
      return bodyId === undefined ? { id: element.id } : { id: element.id, bodyId };
    }),
    bodies,
  });
  return assignments;
}

function validateElementsWithoutBodies(
  elements: readonly Pick<ElementTessellation, "id" | "bodyId">[],
): void {
  for (const element of elements) {
    if (element.bodyId === undefined) continue;
    throw new GeometryValidationError(
      "unknown-element-body",
      `Element ${element.id} references body ${element.bodyId}, but no bodies are declared`,
    );
  }
}

function collectBodyMembership(
  bodies: readonly GeometryBody[],
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
  body: GeometryBody,
  previousBodyId: BodyId | undefined,
  declaredBodies: ReadonlySet<BodyId>,
): void {
  validateBodyId(body.id);
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

function validateBodyId(bodyId: BodyId): void {
  if (isValidOneBasedId(bodyId) && bodyId !== 0) return;
  throw new GeometryValidationError(
    "invalid-body-id",
    `Body id ${bodyId} must be a finite integer in [1, ${MAX_ONE_BASED_ID}]`,
  );
}

function collectBodyElements(
  body: GeometryBody,
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
  elements: readonly Pick<ElementTessellation, "id" | "bodyId">[],
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
  geometry: PartSemanticGeometry,
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
export function validatePickIds(
  geometry: Geometry,
  elements: readonly ElementTessellation[] | undefined,
  nodePositions: Float32Array | undefined,
): void {
  const vertexCount = geometry.positions.length / 3;
  if (geometry.nodePickIds !== undefined && geometry.nodePickIds.length !== vertexCount) {
    throw new Error(
      `nodePickIds must have one entry per vertex (${vertexCount}), got ${geometry.nodePickIds.length}`,
    );
  }
  validateNodePickIds(geometry, nodePositions);
  validateEdges(geometry, elements);
  validateFaceMetadata(geometry, elements, nodePositions);
  validateFaceSubset(geometry);
}

function validateNodePickIds(geometry: Geometry, nodePositions: Float32Array | undefined): void {
  const nodeCount = nodePositions === undefined ? undefined : nodePositions.length / 3;
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
