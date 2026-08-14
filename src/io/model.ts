import type { ElementShape } from "../elements/shapes";

/**
 * Version of the femgx interchange model layout. Bump when a writer changes
 * the meaning of an existing field; adapters gate on this when reading.
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
  readonly count: number;
  readonly ids: Uint32Array;
  readonly coordinates: Float64Array;
}

/**
 * Elements sharing a single shape, stored as row-major typed arrays. Element i
 * has id `ids[i]` and connectivity at `connectivity[nodeCount * i .. +nodeCount)`.
 * Element ids must be unique across the whole model, not just within a block.
 * @category Import and export
 */
export interface ModelElementShapeBlock {
  readonly shape: ElementShape;
  readonly count: number;
  readonly ids: Uint32Array;
  readonly connectivity: Uint32Array;
}

/**
 * A named group of node ids (kind "node") or element ids (kind "element").
 * @category Import and export
 */
export interface ModelSet {
  readonly kind: ModelSetKind;
  readonly name: string;
  readonly ids: Uint32Array;
}

/**
 * A metadata value: a string, a finite number, or a boolean.
 * @category Import and export
 */
export type MetadataValue = string | number | boolean;

/**
 * Model-level metadata as a string-keyed record. Insertion order is preserved
 * by deterministic exporters.
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
  readonly name: string;
  readonly location: ModelSetKind;
  readonly components: number;
  readonly ids: Uint32Array;
  readonly values: Float64Array;
}

/**
 * The versioned interchange model that all adapters import into and export
 * from. It is fully serializable because it contains only typed arrays and
 * plain objects.
 * @category Import and export
 */
export interface FemModel {
  readonly formatVersion: number;
  readonly nodes: ModelNodes;
  readonly elementShapeBlocks: readonly ModelElementShapeBlock[];
  readonly sets: readonly ModelSet[];
  readonly metadata: ModelMetadata;
  readonly results: readonly ModelResultField[];
}
