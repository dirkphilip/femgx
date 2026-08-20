import type { ElementId } from "../elements/element";
import type { BodyId } from "../elements/model";
import { ordinalForId, sortedOrdinals } from "../elements/model-storage";
import type { ElementTessellation, GeometryBody, GeometryInput } from "./types";
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
    if (!hasPrimitiveRange(element, primitive)) continue;
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
  if (!hasPrimitiveRange(element, primitive))
    throw new Error(`Element ${element.id} has no ${primitiveLabel(primitive)}`);
  for (const range of element.primitiveRanges) {
    if (range.primitive !== primitive) continue;
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

function hasPrimitiveRange(
  element: ElementTessellation,
  primitive: "triangles" | "lines" | "points",
): boolean {
  for (const range of element.primitiveRanges) if (range.primitive === primitive) return true;
  return false;
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
  const ranges: { start: number; count: number }[] = [];
  for (const range of element.primitiveRanges) {
    if (range.primitive === primitive) {
      ranges.push({ start: range.primitiveStart, count: range.primitiveCount });
    }
  }
  return ranges;
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
  const elements = geometry.elements ?? [];
  const elementIds = new Uint32Array(elements.length);
  for (let ordinal = 0; ordinal < elements.length; ordinal += 1) {
    elementIds[ordinal] = elements[ordinal]?.id ?? 0;
  }
  const elementOrdinals = sortedOrdinals(elementIds, "Part element", false);
  const membership = collectBodyMembership(bodies, elementIds, elementOrdinals);
  validateElementMembership(
    elements,
    membership.bodyIds,
    membership.elementBodyIds,
    elementIds,
    elementOrdinals,
  );
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
  elementIds: Uint32Array,
  elementOrdinals: Uint32Array,
): {
  readonly bodyIds: Uint32Array;
  readonly elementBodyIds: Uint32Array;
} {
  const bodyIds = new Uint32Array(bodies.length);
  const elementBodyIds = new Uint32Array(elementIds.length);
  let previousBodyId: BodyId | undefined;
  for (let bodyOrdinal = 0; bodyOrdinal < bodies.length; bodyOrdinal += 1) {
    const body = bodies[bodyOrdinal];
    if (body === undefined) throw new Error(`Part has no body ${bodyOrdinal}`);
    validateBodyOrder(body, previousBodyId);
    previousBodyId = body.id;
    bodyIds[bodyOrdinal] = body.id;
    collectBodyElements(body, elementIds, elementOrdinals, elementBodyIds);
  }
  return { bodyIds, elementBodyIds };
}

function validateBodyOrder(body: GeometryBody, previousBodyId: BodyId | undefined): void {
  validateBodyId(body.id);
  if (previousBodyId !== undefined && body.id === previousBodyId) {
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
  elementIds: Uint32Array,
  elementOrdinals: Uint32Array,
  membership: Uint32Array,
): void {
  let previousElementId: ElementId | undefined;
  for (const elementId of body.elementIds) {
    if (previousElementId !== undefined && elementId <= previousElementId) {
      throw new GeometryValidationError(
        "body-order",
        `Body ${body.id} element ids must be strictly ascending`,
      );
    }
    const elementOrdinal = ordinalForId(elementIds, elementOrdinals, elementId);
    if (elementOrdinal === undefined) {
      throw new GeometryValidationError(
        "unknown-body-element",
        `Body ${body.id} references unknown element ${elementId}`,
      );
    }
    if ((membership[elementOrdinal] ?? 0) !== 0) {
      throw new GeometryValidationError(
        "duplicate-body-membership",
        `Element ${elementId} belongs to more than one body`,
      );
    }
    membership[elementOrdinal] = body.id;
    previousElementId = elementId;
  }
}

function validateElementMembership(
  elements: readonly Pick<ElementTessellation, "id" | "bodyId">[],
  bodyIds: Uint32Array,
  membership: Uint32Array,
  elementIds: Uint32Array,
  elementOrdinals: Uint32Array,
): void {
  for (const element of elements) {
    const ordinal = ordinalForId(elementIds, elementOrdinals, element.id);
    const listedBodyId = ordinal === undefined ? 0 : (membership[ordinal] ?? 0);
    if (element.bodyId !== undefined && !containsSorted(bodyIds, element.bodyId)) {
      throw new GeometryValidationError(
        "unknown-element-body",
        `Element ${element.id} references unknown body ${element.bodyId}`,
      );
    }
    if (
      listedBodyId !== (element.bodyId ?? 0) &&
      (listedBodyId !== 0 || element.bodyId !== undefined)
    ) {
      throw new GeometryValidationError(
        "body-membership-mismatch",
        `Element ${element.id} body membership does not match its body metadata`,
      );
    }
  }
}

function containsSorted(ids: Uint32Array, id: number): boolean {
  let low = 0;
  let high = ids.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = ids[middle] ?? 0;
    if (candidate === id) return true;
    if (candidate < id) low = middle + 1;
    else high = middle - 1;
  }
  return false;
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
  geometry: GeometryInput,
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

function validateNodePickIds(
  geometry: GeometryInput,
  nodePositions: Float32Array | undefined,
): void {
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
