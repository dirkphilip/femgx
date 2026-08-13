/** Where a result field stores its values: one per node or one per element. */
export type FieldLocation = "nodal" | "elemental";

/** The shape of a field's per-entity values. */
export type FieldShape = "scalar" | "vector";

/** Number of scalar components each shape stores per entity. */
export const FIELD_COMPONENT_COUNT: Readonly<Record<FieldShape, number>> = {
  scalar: 1,
  vector: 3,
};

/**
 * A typed authored result field: a scalar or vector value per node or per
 * element, all in one unit.
 *
 * Value conventions:
 *
 * - `values` holds `count * components` floats, one entity after another. The
 *   entity index aligns with the owning model's node or element numbering
 *   (the field does not copy the model, it is index-aligned to it).
 * - Missing values are encoded as `NaN` anywhere a component is unknown. All
 *   range helpers skip `NaN` rather than treating it as zero.
 * - `unit` is an opaque, human-readable unit string ("mm", "MPa", ...). The
 *   library never converts units.
 *
 * `values` is referenced, not copied, so it stays cheap for large models.
 * Treat the returned field (and its array) as immutable after construction.
 */
export interface ResultField<S extends FieldShape, L extends FieldLocation> {
  /** Stable, application-addressable identifier. */
  readonly id: string;
  /** Human-readable display name, e.g. "Temperature" or "Authored stress". */
  readonly name: string;
  readonly location: L;
  readonly shape: S;
  /** Number of entities (nodes or elements) the field describes. */
  readonly count: number;
  /** Opaque unit string shared by every value in the field. */
  readonly unit: string;
  /** `count * FIELD_COMPONENT_COUNT[shape]` floats; `NaN` marks missing values. */
  readonly values: Float32Array;
}

/** A scalar field over nodes or elements. */
export type ScalarField<L extends FieldLocation> = ResultField<"scalar", L>;

/** A three-component vector field over nodes or elements. */
export type VectorField<L extends FieldLocation> = ResultField<"vector", L>;

/** Any scalar or vector field at either location. */
export type AnyResultField = ResultField<FieldShape, FieldLocation>;

/** Inputs for {@link createResultField}. */
export interface ResultFieldOptions<S extends FieldShape, L extends FieldLocation> {
  readonly id: string;
  readonly name: string;
  readonly location: L;
  readonly shape: S;
  readonly count: number;
  readonly unit: string;
  readonly values: Float32Array;
}

/**
 * Creates a typed result field after validating the id, name, unit, entity
 * count, and value length. The value array is referenced, not copied.
 */
export function createResultField<S extends FieldShape, L extends FieldLocation>(
  options: ResultFieldOptions<S, L>,
): ResultField<S, L> {
  validateResultField(options);
  return { ...options };
}

/** Returns the scalar value of an entity, or `NaN` when it is missing. */
export function scalarAt<L extends FieldLocation>(
  field: ResultField<"scalar", L>,
  entity: number,
): number {
  return field.values[assertEntity(field, entity)] ?? NaN;
}

/** Returns the three vector components of an entity (may contain `NaN`). */
export function vectorAt<L extends FieldLocation>(
  field: ResultField<"vector", L>,
  entity: number,
): readonly [number, number, number] {
  const base = assertEntity(field, entity) * 3;
  return [field.values[base] ?? NaN, field.values[base + 1] ?? NaN, field.values[base + 2] ?? NaN];
}

function validateResultField<S extends FieldShape, L extends FieldLocation>(
  options: ResultFieldOptions<S, L>,
): void {
  if (options.id.length === 0) throw new Error("Result field id must not be empty");
  if (options.name.length === 0) throw new Error("Result field name must not be empty");
  if (options.location !== "nodal" && options.location !== "elemental") {
    throw new Error(`Unknown result field location "${String(options.location)}"`);
  }
  if (options.shape !== "scalar" && options.shape !== "vector") {
    throw new Error(`Unknown result field shape "${String(options.shape)}"`);
  }
  if (!Number.isInteger(options.count) || options.count < 0) {
    throw new Error(`Result field count must be a non-negative integer, got ${options.count}`);
  }
  if (options.unit.length === 0) throw new Error("Result field unit must not be empty");
  const expected = options.count * FIELD_COMPONENT_COUNT[options.shape];
  if (options.values.length !== expected) {
    throw new Error(
      `Result field ${options.id} of shape ${options.shape} expects ${expected} values but got ${options.values.length}`,
    );
  }
}

function assertEntity<L extends FieldLocation>(
  field: ResultField<FieldShape, L>,
  entity: number,
): number {
  if (!Number.isInteger(entity) || entity < 0 || entity >= field.count) {
    throw new Error(
      `Entity ${entity} is out of range for result field ${field.id} (count ${field.count})`,
    );
  }
  return entity;
}
