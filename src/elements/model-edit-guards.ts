import { bodySnapshot, type BodySnapshot, type MutableModelParts } from "./model-edit-ownership";
import { ElementModelEditError, type ElementModelEditCode } from "./model-edit-types";
import type { BodyId, ElementBlock, ElementBlockId } from "./model-types";

/** Resolves a body snapshot or raises the operation's typed invalid-body error. */
export function requireBodySnapshot(
  parts: MutableModelParts,
  bodyId: BodyId,
  operation: string,
): BodySnapshot {
  const snapshot = bodySnapshot(parts.bodies, bodyId);
  if (snapshot === undefined) {
    fail("invalid-body", operation, `Body ${bodyId} does not exist in the model`);
  }
  return snapshot;
}

/** Resolves the authored block collection or raises the operation's typed no-blocks error. */
export function requireBlocks(parts: MutableModelParts, operation: string): ElementBlock[] {
  if (parts.blocks === undefined || parts.blocks.length === 0) {
    fail("no-blocks", operation, "Element-model edit requires authored semantic blocks");
  }
  return parts.blocks;
}

/** Resolves one authored block or raises the operation's typed missing-block error. */
export function requireBlock(
  blocks: readonly ElementBlock[],
  blockId: ElementBlockId,
  operation: string,
): ElementBlock {
  const block = blocks.find((candidate) => candidate.id === blockId);
  if (block === undefined)
    fail("missing-block", operation, `Element block ${blockId} does not exist`);
  return block;
}

/** Returns ascending unique numeric ids for deterministic edit results. */
export function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Raises the shared typed edit failure without mutating the draft. */
export function fail(code: ElementModelEditCode, operation: string, message: string): never {
  throw new ElementModelEditError(code, operation, message);
}
