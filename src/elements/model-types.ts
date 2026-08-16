import type { ElementId } from "./element";

/**
 * Stable model-local identity of a body.
 * @category Elements and model editing
 */
export type BodyId = number;

/** A non-overlapping, immutable group of authored finite elements. */
export interface Body {
  readonly id: BodyId;
  readonly name?: string;
  readonly elementIds: readonly ElementId[];
}

/**
 * Options for creating an element model with optional authored grouping.
 * @category Elements and model editing
 */
export interface ElementModelOptions {
  readonly bodies?: readonly Body[];
}
