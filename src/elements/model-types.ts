import type { ElementId, NodeId } from "./element";

/**
 * Stable model-local identity of a body.
 * @category Elements and model editing
 */
export type BodyId = number;

/** A non-overlapping, immutable group of authored finite elements. */
export interface Body {
  /** Stable body identifier. */
  readonly id: BodyId;
  /** Optional host-facing display name. */
  readonly name?: string;
  /** Elements directly owned by this body, in ascending order. */
  readonly elementIds: readonly ElementId[];
}

/**
 * Options for creating an element model with optional authored grouping.
 * @category Elements and model editing
 */
export interface ElementModelOptions {
  /** Optional stable ids aligned with coordinate rows; omitted rows use `0..n-1`. */
  readonly nodeIds?: ArrayLike<NodeId>;
  /** Optional direct body ownership groups. */
  readonly bodies?: readonly Body[];
}
