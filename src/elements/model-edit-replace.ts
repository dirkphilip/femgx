import { createElement, type Element, type ElementId } from "./element";
import {
  attachOwnership,
  bodySnapshot,
  detachOwnership,
  resolveBlockBody,
  type BodySnapshot,
  type BlockBodyResolution,
  type MutableModelParts,
} from "./model-edit-ownership";
import {
  ElementModelEditError,
  type ElementBlockReplacement,
  type ElementModelEditCode,
} from "./model-edit-types";
import type { BodyId, ElementBlock, ElementBlockId } from "./model-types";

/** Applies one validated block replacement to a mutable edit draft. */
export function replaceBlock(
  parts: MutableModelParts,
  blockId: ElementBlockId,
  replacement: ElementBlockReplacement,
): void {
  const operation = "replaceBlock";
  const blocks = requireBlocks(parts, operation);
  const block = requireBlock(blocks, blockId, operation);
  const replacementElements = createReplacementElements(replacement, blockId, operation);
  const oldElementIds = new Set(block.elementIds);
  rejectElementCollisions(parts.elements, replacementElements, oldElementIds, operation);
  const appendedNodes = replacement.nodes ?? [];
  validateReplacementNodes(parts, replacementElements, appendedNodes, operation);
  const resolution = resolveBlockBody(block, parts.bodies);
  const targetBodyId = replacement.bodyId ?? ownedBodyId(resolution, operation);
  const targetSnapshot =
    targetBodyId === undefined ? undefined : requireBodySnapshot(parts, targetBodyId, operation);
  const insertionIndex = Math.min(
    ...parts.elements
      .map((element, index) => (oldElementIds.has(element.id) ? index : -1))
      .filter((index) => index >= 0),
  );

  if (targetSnapshot !== undefined) {
    detachOwnership(parts, new Set([blockId]), oldElementIds);
  }
  appendNodes(parts, appendedNodes);
  parts.elements = replaceElements(
    parts.elements,
    oldElementIds,
    replacementElements,
    insertionIndex,
  );
  parts.blocks = blocks.map((candidate) =>
    candidate.id === blockId
      ? {
          id: candidate.id,
          ...(replacement.name === undefined
            ? candidate.name === undefined
              ? {}
              : { name: candidate.name }
            : { name: replacement.name }),
          elementIds: sortedUnique(replacementElements.map((element) => element.id)),
        }
      : candidate,
  );
  if (targetSnapshot !== undefined) {
    attachOwnership(
      parts,
      targetSnapshot,
      blockId,
      replacementElements.map((element) => element.id),
    );
  }
}

function createReplacementElements(
  replacement: ElementBlockReplacement,
  blockId: ElementBlockId,
  operation: string,
): Element[] {
  if (replacement.elements.length === 0) {
    fail("empty-replacement", operation, `Replacement for block ${blockId} must contain elements`);
  }
  const elements = replacement.elements.map((element) =>
    createElement(element.id, element.shape, element.nodeIds),
  );
  const ids = new Set<ElementId>();
  for (const element of elements) {
    if (ids.has(element.id)) {
      fail(
        "duplicate-replacement-element",
        operation,
        `Replacement for block ${blockId} repeats element id ${element.id}`,
      );
    }
    ids.add(element.id);
  }
  return elements;
}

function rejectElementCollisions(
  existing: readonly Element[],
  replacement: readonly Element[],
  retainedIds: ReadonlySet<ElementId>,
  operation: string,
): void {
  const existingIds = new Set(existing.map((element) => element.id));
  for (const element of replacement) {
    if (existingIds.has(element.id) && !retainedIds.has(element.id)) {
      fail(
        "element-id-collision",
        operation,
        `Replacement element id ${element.id} belongs to another block or is unowned`,
      );
    }
  }
}

function replaceElements(
  elements: readonly Element[],
  removedIds: ReadonlySet<ElementId>,
  replacement: readonly Element[],
  insertionIndex: number,
): Element[] {
  const next: Element[] = [];
  for (const [index, element] of elements.entries()) {
    if (removedIds.has(element.id)) {
      if (index === insertionIndex) next.push(...replacement);
      continue;
    }
    next.push(element);
  }
  return next;
}

function validateReplacementNodes(
  parts: MutableModelParts,
  elements: readonly Element[],
  appendedNodes: readonly number[],
  operation: string,
): void {
  if (appendedNodes.length % 3 !== 0 || appendedNodes.some((value) => !Number.isFinite(value))) {
    fail(
      "invalid-replacement-nodes",
      operation,
      "Replacement nodes must contain finite xyz triples",
    );
  }
  const firstNewNode = parts.nodes.length / 3;
  const lastNewNode = firstNewNode + appendedNodes.length / 3;
  for (const element of elements) {
    for (const nodeId of element.nodeIds) {
      if (nodeId >= firstNewNode && nodeId >= lastNewNode) {
        fail(
          "replacement-node-range",
          operation,
          `Replacement element ${element.id} references node ${nodeId} outside appended nodes`,
        );
      }
    }
  }
}

function appendNodes(parts: MutableModelParts, nodes: readonly number[]): void {
  if (nodes.length === 0) return;
  const appended = new Float32Array(parts.nodes.length + nodes.length);
  appended.set(parts.nodes);
  appended.set(nodes, parts.nodes.length);
  parts.nodes = appended;
}

function ownedBodyId(resolution: BlockBodyResolution, operation: string): BodyId | undefined {
  if (resolution.kind === "ambiguous") {
    fail("body-conflict", operation, "Block ownership is ambiguous; supply an explicit bodyId");
  }
  return resolution.kind === "owned" ? resolution.bodyId : undefined;
}

function requireBodySnapshot(
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

function requireBlocks(parts: MutableModelParts, operation: string): ElementBlock[] {
  if (parts.blocks === undefined || parts.blocks.length === 0) {
    fail("no-blocks", operation, "Element-model edit requires authored semantic blocks");
  }
  return parts.blocks;
}

function requireBlock(
  blocks: readonly ElementBlock[],
  blockId: ElementBlockId,
  operation: string,
): ElementBlock {
  const block = blocks.find((candidate) => candidate.id === blockId);
  if (block === undefined)
    fail("missing-block", operation, `Element block ${blockId} does not exist`);
  return block;
}

function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function fail(code: ElementModelEditCode, operation: string, message: string): never {
  throw new ElementModelEditError(code, operation, message);
}
