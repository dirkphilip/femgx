import type { Element, ElementId } from "./element";
import { at } from "./indices";
import type { Body, BodyId } from "./model-types";

/** Machine-readable failure from the authoritative element-model boundary. */
export type ElementModelValidationCode =
  | "duplicate-element-id"
  | "invalid-body-id"
  | "duplicate-body-id"
  | "body-order"
  | "empty-body"
  | "unknown-body-element"
  | "duplicate-body-membership";

/** Typed validation error for an invalid authored element model. */
export class ElementModelValidationError extends Error {
  readonly code: ElementModelValidationCode;

  constructor(code: ElementModelValidationCode, message: string) {
    super(message);
    this.name = "ElementModelValidationError";
    this.code = code;
  }
}

/** Validates authored element ids and optional direct body ownership. */
export function validateElementModel(
  elements: readonly Element[],
  bodies: readonly Body[] | undefined,
): void {
  const elementIds = validateElements(elements);
  validateBodies(bodies, elementIds);
}

function validateElements(elements: readonly Element[]): ReadonlySet<ElementId> {
  const seen = new Set<ElementId>();
  for (const element of elements) {
    if (seen.has(element.id)) {
      throw new ElementModelValidationError(
        "duplicate-element-id",
        `Element model repeats element id ${element.id}`,
      );
    }
    seen.add(element.id);
  }
  return seen;
}

function validateBodies(
  bodies: readonly Body[] | undefined,
  elementIds: ReadonlySet<ElementId>,
): void {
  if (bodies === undefined) return;
  const bodyIds = new Set<BodyId>();
  const elementBodies = new Map<ElementId, BodyId>();
  let previousId: BodyId | undefined;
  for (const body of bodies) {
    validateStableId(body.id);
    if (bodyIds.has(body.id)) {
      throw new ElementModelValidationError("duplicate-body-id", `Duplicate body id ${body.id}`);
    }
    if (previousId !== undefined && body.id <= previousId) {
      throw new ElementModelValidationError(
        "body-order",
        `Body ids must be strictly ascending; ${body.id} follows ${previousId}`,
      );
    }
    if (body.elementIds.length === 0) {
      throw new ElementModelValidationError("empty-body", `Body ${body.id} has no elements`);
    }
    validateAscending(body.elementIds, `Body ${body.id} element ids`);
    for (const elementId of body.elementIds) {
      if (!elementIds.has(elementId)) {
        throw new ElementModelValidationError(
          "unknown-body-element",
          `Body ${body.id} references unknown element ${elementId}`,
        );
      }
      if (elementBodies.has(elementId)) {
        throw new ElementModelValidationError(
          "duplicate-body-membership",
          `Element ${elementId} belongs to more than one body`,
        );
      }
      elementBodies.set(elementId, body.id);
    }
    bodyIds.add(body.id);
    previousId = body.id;
  }
}

function validateStableId(id: number): void {
  if (Number.isSafeInteger(id) && id >= 1 && id <= 0xffff_fffe) return;
  throw new ElementModelValidationError(
    "invalid-body-id",
    `Body id ${id} must be a finite integer in [1, 4294967294]`,
  );
}

function validateAscending(ids: readonly number[], label: string): void {
  for (let index = 1; index < ids.length; index += 1) {
    if (at(ids, index) <= at(ids, index - 1)) {
      throw new ElementModelValidationError("body-order", `${label} must be strictly ascending`);
    }
  }
}
