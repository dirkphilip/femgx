import type { ElementShape } from "../elements/shapes";

/**
 * Version of the femgx interchange model layout. Bump when a producer changes
 * the meaning of an existing field; consumers can gate on this when reading.
 * @category Import and export
 */
export const FEMGX_FORMAT_VERSION = 1;

/**
 * The kind of entity a set or a result field is attached to.
 * @category Import and export
 */
export type ModelSetKind = "node" | "element";

/**
 * Typed-array storage for a model's nodes. Rows are indexed by position:
 * node i has id `ids[i]` and coordinates `coordinates[3i], [3i+1], [3i+2]`.
 * Node ids are the authoritative identity used by elements, sets, and results.
 * @category Import and export
 */
export interface ModelNodes {
  /** Number of nodes in the model. */
  readonly count: number;
  /** Stable node ids aligned with coordinate rows. */
  readonly ids: Uint32Array;
  /** Flat xyz coordinates, three values per node. */
  readonly coordinates: Float64Array;
}

/**
 * Elements sharing a single shape, stored as row-major typed arrays. Element i
 * has id `ids[i]` and connectivity at `connectivity[nodeCount * i .. +nodeCount)`.
 * Element ids must be unique across the whole model, not just within a block.
 * @category Import and export
 */
export interface ModelElementShapeBlock {
  /** Shape shared by every element row in this block. */
  readonly shape: ElementShape;
  /** Number of element rows. */
  readonly count: number;
  /** Stable element ids aligned with connectivity rows. */
  readonly ids: Uint32Array;
  /** Row-major node connectivity. */
  readonly connectivity: Uint32Array;
}

/**
 * A named group of node ids (kind "node") or element ids (kind "element").
 * @category Import and export
 */
export interface ModelSet {
  /** Entity kind addressed by this set. */
  readonly kind: ModelSetKind;
  /** Host-facing set name. */
  readonly name: string;
  /** Stable ids belonging to the set. */
  readonly ids: Uint32Array;
}

/**
 * A metadata value: a string, a finite number, or a boolean.
 * @category Import and export
 */
export type MetadataValue = string | number | boolean;

/**
 * Model-level metadata as a string-keyed record. Insertion order is preserved
 * by deterministic consumers.
 * @category Import and export
 */
export type ModelMetadata = Readonly<Record<string, MetadataValue>>;

/**
 * A named result field aligned to node or element ids. `ids` lists the entity
 * each row of `values` belongs to; `values` holds `ids.length * components`
 * numbers in row-major order.
 * @category Import and export
 */
export interface ModelResultField {
  /** Host-facing result name. */
  readonly name: string;
  /** Whether rows address nodes or elements. */
  readonly location: ModelSetKind;
  /** Number of numeric components per row. */
  readonly components: number;
  /** Stable entity ids aligned with value rows. */
  readonly ids: Uint32Array;
  /** Row-major result values. */
  readonly values: Float64Array;
}

/**
 * The versioned, host-supplied model boundary. It is fully serializable because
 * it contains only typed arrays and plain objects.
 * @category Import and export
 */
export interface FemModel {
  /** Interchange layout version. */
  readonly formatVersion: number;
  /** Node table. */
  readonly nodes: ModelNodes;
  /** Shape-grouped element tables. */
  readonly elementShapeBlocks: readonly ModelElementShapeBlock[];
  /** Named node or element sets. */
  readonly sets: readonly ModelSet[];
  /** Host-defined metadata. */
  readonly metadata: ModelMetadata;
  /** Authored result fields. */
  readonly results: readonly ModelResultField[];
}
