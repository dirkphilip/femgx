import type { ElementId } from "./element";

/**
 * Stable model-local identity of an authored semantic element block.
 * @category Elements and model editing
 */
export type ElementBlockId = number;

/**
 * Stable model-local identity of a body.
 * @category Elements and model editing
 */
export type BodyId = number;

/**
 * A non-overlapping, immutable group of authored finite elements.
 * @category Elements and model editing
 */
export interface ElementBlock {
  readonly id: ElementBlockId;
  readonly name?: string;
  readonly elementIds: readonly ElementId[];
}

/**
 * A body owns either direct elements or semantic blocks, never both.
 * @category Elements and model editing
 */
export type Body = {
  readonly id: BodyId;
  readonly name?: string;
} & (
  | { readonly elementIds: readonly ElementId[]; readonly blockIds?: never }
  | { readonly blockIds: readonly ElementBlockId[]; readonly elementIds?: never }
);

/**
 * Options for creating an element model with optional authored grouping.
 * @category Elements and model editing
 */
export interface ElementModelOptions {
  readonly blocks?: readonly ElementBlock[];
  readonly bodies?: readonly Body[];
}
