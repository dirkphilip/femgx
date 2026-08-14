import type { Element, ElementId } from "./element";
import type { ElementModel } from "./model";
import type { BodyId, ElementBlockId } from "./model-types";

/** Machine-readable failure from an element-model edit transaction. */
export type ElementModelEditCode =
  | "no-blocks"
  | "missing-block"
  | "duplicate-source"
  | "empty-source"
  | "body-conflict"
  | "invalid-body"
  | "dissolve-policy-required"
  | "empty-replacement"
  | "invalid-replacement-nodes"
  | "replacement-node-range"
  | "duplicate-replacement-element"
  | "element-id-collision";

/** Typed error for a forbidden or ambiguous element-model edit. */
export class ElementModelEditError extends Error {
  readonly code: ElementModelEditCode;
  readonly operation: string;

  constructor(code: ElementModelEditCode, operation: string, message: string) {
    super(message);
    this.name = "ElementModelEditError";
    this.code = code;
    this.operation = operation;
  }
}

/** Input for merging source blocks into an existing target block. */
export interface MergeElementBlocksInput {
  readonly sourceIds: readonly ElementBlockId[];
  readonly targetId: ElementBlockId;
  readonly targetName?: string;
  readonly bodyId?: BodyId;
}

/** Policy required when dissolving a block-owned body. */
export type DissolveBlockBodyPolicy = "direct" | "unassigned";

/** Optional policy for dissolving a semantic block. */
export interface DissolveElementBlockOptions {
  readonly bodyPolicy?: DissolveBlockBodyPolicy;
}

/** Replacement topology for one existing block. New nodes append to the model. */
export interface ElementBlockReplacement {
  readonly elements: readonly Element[];
  /** Flat xyz coordinates for nodes with ids starting at the old node count. */
  readonly nodes?: readonly number[];
  readonly name?: string;
  readonly bodyId?: BodyId;
}

/** Stable semantic identity changes produced by one committed edit. */
export interface ElementModelEditReport {
  readonly addedNodeIds: readonly number[];
  readonly unusedNodeIds: readonly number[];
  readonly addedElementIds: readonly ElementId[];
  readonly removedElementIds: readonly ElementId[];
  readonly retainedElementIds: readonly ElementId[];
  readonly addedBlockIds: readonly ElementBlockId[];
  readonly removedBlockIds: readonly ElementBlockId[];
  readonly retainedBlockIds: readonly ElementBlockId[];
  readonly addedBodyIds: readonly BodyId[];
  readonly removedBodyIds: readonly BodyId[];
  readonly retainedBodyIds: readonly BodyId[];
}

/** The immutable model and identity report returned by an edit transaction. */
export interface ElementModelEditResult {
  readonly model: ElementModel;
  readonly report: ElementModelEditReport;
}

/** Operations available inside one atomic element-model edit transaction. */
export interface ElementModelEditor {
  mergeBlocks(input: MergeElementBlocksInput): void;
  removeBlock(blockId: ElementBlockId): void;
  dissolveBlock(blockId: ElementBlockId, options?: DissolveElementBlockOptions): void;
  replaceBlock(blockId: ElementBlockId, replacement: ElementBlockReplacement): void;
}
