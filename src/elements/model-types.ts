import type { ElementId } from "./element";

/** Stable model-local identity of an authored semantic element block. */
export type ElementBlockId = number;

/** Stable model-local identity of a body. */
export type BodyId = number;

/** A non-overlapping, immutable group of authored finite elements. */
export interface ElementBlock {
  readonly id: ElementBlockId;
  readonly name?: string;
  readonly elementIds: readonly ElementId[];
}

/** A body owns either direct elements or semantic blocks, never both. */
export type Body = {
  readonly id: BodyId;
  readonly name?: string;
} & (
  | { readonly elementIds: readonly ElementId[]; readonly blockIds?: never }
  | { readonly blockIds: readonly ElementBlockId[]; readonly elementIds?: never }
);

/** Options for creating an element model with optional authored grouping. */
export interface ElementModelOptions {
  readonly blocks?: readonly ElementBlock[];
  readonly bodies?: readonly Body[];
}
