import type { Element, ElementId } from "./element";
import { at } from "./indices";
import type { Body, BodyId, ElementBlock, ElementBlockId } from "./model-types";

/**
 * Machine-readable failure from the authoritative element-model boundary.
 * @category Elements and model editing
 */
export type ElementModelValidationCode =
  | "duplicate-element-id"
  | "invalid-block-id"
  | "duplicate-block-id"
  | "block-order"
  | "empty-block"
  | "unknown-block-element"
  | "duplicate-block-membership"
  | "invalid-body-id"
  | "duplicate-body-id"
  | "body-order"
  | "body-membership-form"
  | "empty-body"
  | "unknown-body-element"
  | "unknown-body-block"
  | "duplicate-body-membership"
  | "block-body-mismatch";

/**
 * Typed validation error for an invalid authored element model.
 * @category Elements and model editing
 */
export class ElementModelValidationError extends Error {
  readonly code: ElementModelValidationCode;

  constructor(code: ElementModelValidationCode, message: string) {
    super(message);
    this.name = "ElementModelValidationError";
    this.code = code;
  }
}

/** Validates all authored element, block, and body ownership invariants. */
export function validateElementModel(
  elements: readonly Element[],
  blocks: readonly ElementBlock[] | undefined,
  bodies: readonly Body[] | undefined,
): void {
  const elementIds = validateElements(elements);
  const blockIds = validateBlocks(blocks, elementIds);
  validateBodies(bodies, elementIds, blockIds, blocks);
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

function validateBlocks(
  blocks: readonly ElementBlock[] | undefined,
  elementIds: ReadonlySet<ElementId>,
): ReadonlySet<ElementBlockId> {
  if (blocks === undefined) return new Set();
  const ids = new Set<ElementBlockId>();
  const memberships = new Set<ElementId>();
  let previousId: ElementBlockId | undefined;
  for (const block of blocks) {
    validateStableId(block.id, "Element block", "invalid-block-id");
    if (ids.has(block.id)) {
      throw new ElementModelValidationError(
        "duplicate-block-id",
        `Duplicate element block id ${block.id}`,
      );
    }
    if (previousId !== undefined && block.id <= previousId) {
      throw new ElementModelValidationError(
        "block-order",
        `Element block ids must be strictly ascending; ${block.id} follows ${previousId}`,
      );
    }
    if (block.elementIds.length === 0) {
      throw new ElementModelValidationError(
        "empty-block",
        `Element block ${block.id} has no elements`,
      );
    }
    validateAscending(block.elementIds, `Element block ${block.id} element ids`, "block-order");
    for (const elementId of block.elementIds) {
      if (!elementIds.has(elementId)) {
        throw new ElementModelValidationError(
          "unknown-block-element",
          `Element block ${block.id} references unknown element ${elementId}`,
        );
      }
      if (memberships.has(elementId)) {
        throw new ElementModelValidationError(
          "duplicate-block-membership",
          `Element ${elementId} belongs to more than one element block`,
        );
      }
      memberships.add(elementId);
    }
    ids.add(block.id);
    previousId = block.id;
  }
  return ids;
}

function validateBodies(
  bodies: readonly Body[] | undefined,
  elementIds: ReadonlySet<ElementId>,
  blockIds: ReadonlySet<ElementBlockId>,
  blocks: readonly ElementBlock[] | undefined,
): void {
  if (bodies === undefined) return;
  const bodyIds = new Set<BodyId>();
  const elementBodies = new Map<ElementId, BodyId>();
  const blockBodies = new Map<ElementBlockId, BodyId>();
  let previousId: BodyId | undefined;
  for (const body of bodies) {
    validateStableId(body.id, "Body", "invalid-body-id");
    if (bodyIds.has(body.id)) {
      throw new ElementModelValidationError("duplicate-body-id", `Duplicate body id ${body.id}`);
    }
    if (previousId !== undefined && body.id <= previousId) {
      throw new ElementModelValidationError(
        "body-order",
        `Body ids must be strictly ascending; ${body.id} follows ${previousId}`,
      );
    }
    if ("elementIds" in body === "blockIds" in body) {
      throw new ElementModelValidationError(
        "body-membership-form",
        `Body ${body.id} must declare exactly one of elementIds or blockIds`,
      );
    }
    if (hasDirectMembership(body)) {
      validateDirectBody(body, elementIds, elementBodies);
    } else {
      validateBlockBody(body, blockIds, blockBodies, blocks);
    }
    bodyIds.add(body.id);
    previousId = body.id;
  }
  validateBlockBodyConsistency(blocks, blockBodies, elementBodies);
}

function hasDirectMembership(
  body: Body,
): body is Extract<Body, { readonly elementIds: readonly ElementId[] }> {
  return body.elementIds !== undefined;
}

function validateDirectBody(
  body: Extract<Body, { readonly elementIds: readonly ElementId[] }>,
  elementIds: ReadonlySet<ElementId>,
  elementBodies: Map<ElementId, BodyId>,
): void {
  if (body.elementIds.length === 0) {
    throw new ElementModelValidationError("empty-body", `Body ${body.id} has no elements`);
  }
  validateAscending(body.elementIds, `Body ${body.id} element ids`, "body-order");
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
}

function validateBlockBody(
  body: Extract<Body, { readonly blockIds: readonly ElementBlockId[] }>,
  blockIds: ReadonlySet<ElementBlockId>,
  blockBodies: Map<ElementBlockId, BodyId>,
  blocks: readonly ElementBlock[] | undefined,
): void {
  if (body.blockIds.length === 0) {
    throw new ElementModelValidationError("empty-body", `Body ${body.id} has no blocks`);
  }
  if (blocks === undefined) {
    throw new ElementModelValidationError(
      "unknown-body-block",
      `Body ${body.id} references blocks but the model declares no blocks`,
    );
  }
  validateAscending(body.blockIds, `Body ${body.id} block ids`, "body-order");
  for (const blockId of body.blockIds) {
    if (!blockIds.has(blockId)) {
      throw new ElementModelValidationError(
        "unknown-body-block",
        `Body ${body.id} references unknown element block ${blockId}`,
      );
    }
    if (blockBodies.has(blockId)) {
      throw new ElementModelValidationError(
        "duplicate-body-membership",
        `Element block ${blockId} belongs to more than one body`,
      );
    }
    blockBodies.set(blockId, body.id);
  }
}

function validateBlockBodyConsistency(
  blocks: readonly ElementBlock[] | undefined,
  blockBodies: ReadonlyMap<ElementBlockId, BodyId>,
  elementBodies: ReadonlyMap<ElementId, BodyId>,
): void {
  if (blocks === undefined) return;
  for (const block of blocks) {
    const bodyId = blockBodies.get(block.id);
    if (bodyId === undefined) continue;
    for (const elementId of block.elementIds) {
      const existingBody = elementBodies.get(elementId);
      if (existingBody !== undefined && existingBody !== bodyId) {
        throw new ElementModelValidationError(
          "block-body-mismatch",
          `Element ${elementId} is assigned to body ${existingBody} and block-defined body ${bodyId}`,
        );
      }
    }
  }
}

function validateStableId(
  id: number,
  label: string,
  code: "invalid-block-id" | "invalid-body-id",
): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > 0xffff_fffe) {
    throw new ElementModelValidationError(
      code,
      `${label} id ${id} must be a finite integer in [1, 4294967294]`,
    );
  }
}

function validateAscending(
  ids: readonly number[],
  label: string,
  code: "block-order" | "body-order",
): void {
  for (let index = 1; index < ids.length; index += 1) {
    const previous = at(ids, index - 1);
    const current = at(ids, index);
    if (current <= previous) {
      throw new ElementModelValidationError(code, `${label} must be strictly ascending`);
    }
  }
}
