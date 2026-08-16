import { type ElementId } from "./element";
import {
  attachOwnership,
  detachOwnership,
  resolveBlockBody,
  type BodyMembershipKind,
  type BlockBodyResolution,
  type MutableModelParts,
} from "./model-edit-ownership";
import { createElementModel, type ElementModel } from "./model";
import type { Body, BodyId, ElementBlock, ElementBlockId } from "./model-types";
import {
  type DissolveElementBlockOptions,
  type ElementModelEditResult,
  type ElementModelEditor,
  type MergeElementBlocksInput,
} from "./model-edit-types";
import { createReport, emptyReport } from "./model-edit-report";
import { replaceBlock } from "./model-edit-replace";
import {
  fail,
  requireBlock,
  requireBlocks,
  requireBodySnapshot,
  sortedUnique,
} from "./model-edit-guards";

export { ElementModelEditError } from "./model-edit-types";
export type {
  DissolveBlockBodyPolicy,
  DissolveElementBlockOptions,
  ElementBlockReplacement,
  ElementModelEditCode,
  ElementModelEditReport,
  ElementModelEditResult,
  ElementModelEditor,
  MergeElementBlocksInput,
} from "./model-edit-types";

/**
 * Applies semantic element-block edits atomically and returns one immutable
 * model plus a stable identity reconciliation report.
 * @category Elements and model editing
 */
export function editElementModel(
  model: ElementModel,
  configure: (editor: ElementModelEditor) => void,
): ElementModelEditResult {
  let parts: MutableModelParts | undefined;
  let operationCount = 0;
  const ensureParts = (): MutableModelParts => {
    parts ??= toMutableParts(model);
    return parts;
  };
  const editor: ElementModelEditor = {
    mergeBlocks: (input) => {
      mergeBlocks(ensureParts(), input);
      operationCount += 1;
    },
    removeBlock: (blockId) => {
      removeBlock(ensureParts(), blockId);
      operationCount += 1;
    },
    dissolveBlock: (blockId, options) => {
      dissolveBlock(ensureParts(), blockId, options);
      operationCount += 1;
    },
    replaceBlock: (blockId, replacement) => {
      replaceBlock(ensureParts(), blockId, replacement);
      operationCount += 1;
    },
  };
  configure(editor);
  if (operationCount === 0) {
    return { model, report: emptyReport() };
  }
  if (parts === undefined) throw new Error("An element-model edit did not create a draft");
  const next = fromMutableParts(parts);
  return { model: next, report: createReport(model, next) };
}

function mergeBlocks(parts: MutableModelParts, input: MergeElementBlocksInput): void {
  const operation = "mergeBlocks";
  const blocks = requireBlocks(parts, operation);
  const target = requireBlock(blocks, input.targetId, operation);
  const sourceIds = uniqueSourceIds(input.sourceIds, operation);
  const sourceBlocks = sourceIds
    .filter((blockId) => blockId !== input.targetId)
    .map((blockId) => requireBlock(blocks, blockId, operation));
  if (sourceBlocks.length === 0) {
    fail("empty-source", operation, `Block ${input.targetId} has no source block to merge`);
  }
  const allBlocks = [target, ...sourceBlocks];
  const resolutions = allBlocks.map((block) => resolveBlockBody(block, parts.bodies));
  const bodyId = resolveMergeBody(resolutions, input.bodyId, operation);
  const elementIds = sortedUnique(allBlocks.flatMap((block) => block.elementIds));
  const sourceBlockIds = new Set(sourceBlocks.map((block) => block.id));

  if (input.bodyId !== undefined) {
    const snapshot = requireBodySnapshot(parts, input.bodyId, operation);
    detachOwnership(parts, new Set(allBlocks.map((block) => block.id)), new Set(elementIds));
    replaceBlocks(parts, input.targetId, sourceBlockIds, elementIds, input.targetName);
    attachOwnership(parts, snapshot, input.targetId, elementIds);
    return;
  }

  replaceBlocks(parts, input.targetId, sourceBlockIds, elementIds, input.targetName);
  if (bodyId !== undefined && bodyMembershipKind(parts.bodies, bodyId) === "block") {
    detachOwnership(parts, sourceBlockIds, new Set());
  }
}

function removeBlock(parts: MutableModelParts, blockId: ElementBlockId): void {
  const operation = "removeBlock";
  const blocks = requireBlocks(parts, operation);
  const block = requireBlock(blocks, blockId, operation);
  const removedElements = new Set(block.elementIds);
  parts.elements = parts.elements.filter((element) => !removedElements.has(element.id));
  parts.blocks = blocks.filter((candidate) => candidate.id !== blockId);
  detachOwnership(parts, new Set([blockId]), removedElements);
  if (parts.blocks.length === 0) parts.blocks = undefined;
}

function dissolveBlock(
  parts: MutableModelParts,
  blockId: ElementBlockId,
  options: DissolveElementBlockOptions | undefined,
): void {
  const operation = "dissolveBlock";
  const blocks = requireBlocks(parts, operation);
  const block = requireBlock(blocks, blockId, operation);
  const owner = parts.bodies?.find(
    (body): body is Extract<Body, { readonly blockIds: readonly ElementBlockId[] }> =>
      "blockIds" in body && body.blockIds.includes(blockId),
  );
  if (owner !== undefined) {
    const policy = options?.bodyPolicy;
    if (policy !== "direct" && policy !== "unassigned") {
      fail(
        "dissolve-policy-required",
        operation,
        `Dissolving block ${blockId} requires bodyPolicy "direct" or "unassigned"`,
      );
    }
    if (policy === "direct") {
      const snapshot = requireBodySnapshot(parts, owner.id, operation);
      const retainedBlockIds = owner.blockIds.filter((id) => id !== blockId);
      const retainedElements = (parts.blocks ?? [])
        .filter((candidate) => owner.blockIds.includes(candidate.id))
        .flatMap((candidate) => candidate.elementIds);
      detachOwnership(parts, new Set(owner.blockIds), new Set());
      parts.blocks = blocks.filter((candidate) => candidate.id !== blockId);
      attachOwnership(
        parts,
        { ...snapshot, kind: "element" },
        blockId,
        sortedUnique(retainedElements.concat(block.elementIds)),
      );
      if (retainedBlockIds.length === 0 && parts.blocks.length === 0) parts.blocks = undefined;
      return;
    }
    detachOwnership(parts, new Set([blockId]), new Set());
  }
  parts.blocks = blocks.filter((candidate) => candidate.id !== blockId);
  if (parts.blocks.length === 0) parts.blocks = undefined;
}

function resolveMergeBody(
  resolutions: readonly BlockBodyResolution[],
  explicitBodyId: BodyId | undefined,
  operation: string,
): BodyId | undefined {
  if (explicitBodyId !== undefined) return explicitBodyId;
  if (resolutions.some((resolution) => resolution.kind === "ambiguous")) {
    fail("body-conflict", operation, "Block ownership is ambiguous; supply an explicit bodyId");
  }
  const first = resolutions[0];
  if (first === undefined || first.kind === "unowned") {
    if (resolutions.some((resolution) => resolution.kind !== "unowned")) {
      fail("body-conflict", operation, "Blocks have conflicting effective body ownership");
    }
    return undefined;
  }
  if (first.kind !== "owned") {
    fail("body-conflict", operation, "Blocks have conflicting effective body ownership");
  }
  if (
    resolutions.some(
      (resolution) => resolution.kind !== "owned" || resolution.bodyId !== first.bodyId,
    )
  ) {
    fail("body-conflict", operation, "Blocks have conflicting effective body ownership");
  }
  return first.bodyId;
}

function bodyMembershipKind(
  bodies: readonly Body[] | undefined,
  bodyId: BodyId,
): BodyMembershipKind | undefined {
  const body = bodies?.find((candidate) => candidate.id === bodyId);
  if (body === undefined) return undefined;
  return "elementIds" in body ? "element" : "block";
}

function uniqueSourceIds(
  sourceIds: readonly ElementBlockId[],
  operation: string,
): readonly ElementBlockId[] {
  const unique = new Set<ElementBlockId>();
  for (const blockId of sourceIds) {
    if (unique.has(blockId)) {
      fail("duplicate-source", operation, `Source block id ${blockId} is repeated`);
    }
    unique.add(blockId);
  }
  return [...unique];
}

function replaceBlocks(
  parts: MutableModelParts,
  targetId: ElementBlockId,
  sourceIds: ReadonlySet<ElementBlockId>,
  elementIds: readonly ElementId[],
  targetName: string | undefined,
): void {
  const target = parts.blocks?.find((block) => block.id === targetId);
  if (target === undefined) return;
  parts.blocks = (parts.blocks ?? []).flatMap((block) => {
    if (sourceIds.has(block.id) && block.id !== targetId) return [];
    return block.id === targetId
      ? [
          {
            id: block.id,
            ...(targetName === undefined
              ? block.name === undefined
                ? {}
                : { name: block.name }
              : { name: targetName }),
            elementIds,
          },
        ]
      : [block];
  });
}

function toMutableParts(model: ElementModel): MutableModelParts {
  const normalized = createElementModel(
    [...model.nodes],
    model.elements,
    modelOptions(model.blocks, model.bodies),
  );
  return {
    nodes: new Float32Array(normalized.nodes),
    elements: normalized.elements.map((element) => ({ ...element, nodeIds: [...element.nodeIds] })),
    blocks: normalized.blocks?.map((block) => ({ ...block, elementIds: [...block.elementIds] })),
    bodies: normalized.bodies?.map((body): Body =>
      "elementIds" in body
        ? {
            id: body.id,
            ...(body.name === undefined ? {} : { name: body.name }),
            elementIds: [...body.elementIds],
          }
        : {
            id: body.id,
            ...(body.name === undefined ? {} : { name: body.name }),
            blockIds: [...body.blockIds],
          },
    ),
  };
}

function fromMutableParts(parts: MutableModelParts): ElementModel {
  return createElementModel(
    Array.from(parts.nodes),
    parts.elements,
    modelOptions(parts.blocks, parts.bodies),
  );
}

function modelOptions(
  blocks: readonly ElementBlock[] | undefined,
  bodies: readonly Body[] | undefined,
): { readonly blocks?: readonly ElementBlock[]; readonly bodies?: readonly Body[] } {
  return {
    ...(blocks === undefined ? {} : { blocks }),
    ...(bodies === undefined ? {} : { bodies }),
  };
}
