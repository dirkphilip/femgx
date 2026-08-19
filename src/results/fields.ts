import type { PartId } from "../geometry/part";

/**
 * Where a result field stores its values: one per node or one per element.
 * @category Results
 */
export type FieldLocation = "nodal" | "elemental";

/**
 * The shape of a field's per-entity values.
 * @category Results
 */
export type FieldShape = "scalar" | "vector";

/** Number of components in one authored elemental orthonormal frame row. */
export const FRAME_COMPONENT_COUNT = 9;

/** Number of authored nodal load components: force xyz followed by moment xyz. */
export const LOAD_COMPONENT_COUNT = 6;

/**
 * An authored six-degree-of-freedom nodal load. The first three components
 * are force (Fx, Fy, Fz); the final three are moment (Mx, My, Mz). Force and
 * moment units are explicit because the two triplets are dimensionally distinct.
 * Missing components are encoded as `NaN` independently.
 * @category Results
 */
export interface NodalLoadField {
  /** Reusable part whose dense node ids index this field. */
  readonly partId: PartId;
  /** Stable application-addressable field identifier. */
  readonly id: string;
  /** Human-readable field name. */
  readonly name: string;
  /** Loads are always authored per node. */
  readonly location: "nodal";
  /** Load rows contain force and moment vectors. */
  readonly shape: "load";
  /** Number of dense node rows in `values`. */
  readonly count: number;
  /** Opaque unit label for the force components. */
  readonly forceUnit: string;
  /** Opaque unit label for the moment components. */
  readonly momentUnit: string;
  /** Row-major force xyz followed by moment xyz for every node. */
  readonly values: Float32Array;
}

/** Inputs for {@link createNodalLoadField}. */
export interface NodalLoadFieldOptions {
  /** Reusable part whose dense node rows this field addresses. */
  readonly partId: PartId;
  /** Stable application-addressable field identifier. */
  readonly id: string;
  /** Human-readable field name. */
  readonly name: string;
  /** Number of dense node rows supplied in `values`. */
  readonly count: number;
  /** Opaque unit label for the force components. */
  readonly forceUnit: string;
  /** Opaque unit label for the moment components. */
  readonly momentUnit: string;
  /** Row-major force xyz and moment xyz, six floats per node row. */
  readonly values: Float32Array;
}

/**
 * An authored X/Y/Z frame for each element. Values are stored row-major as
 * three consecutive xyz axes (`x`, `y`, `z`) per dense part-local element id.
 * `NaN` in any component marks the complete frame row as missing.
 * @category Results
 */
export interface ElementFrameField {
  /** Reusable part whose dense element ids index this field. */
  readonly partId: PartId;
  /** Stable application-addressable field identifier. */
  readonly id: string;
  /** Human-readable field name. */
  readonly name: string;
  /** Frames are always authored per element. */
  readonly location: "elemental";
  /** Frames contain nine components per element row. */
  readonly shape: "frame";
  /** Number of dense element rows in `values`. */
  readonly count: number;
  /** Opaque unit label supplied by the host. */
  readonly unit: string;
  /** Row-major XYZ axes; any `NaN` marks that element frame as missing. */
  readonly values: Float32Array;
}

/**
 * Inputs for {@link createElementFrameField}.
 * @category Results
 */
export interface ElementFrameFieldOptions {
  /** Reusable part whose dense element rows this field addresses. */
  readonly partId: PartId;
  /** Stable application-addressable field identifier. */
  readonly id: string;
  /** Human-readable field name. */
  readonly name: string;
  /** Number of dense element rows supplied in `values`. */
  readonly count: number;
  /** Opaque unit label supplied by the host. */
  readonly unit: string;
  /** Row-major XYZ axes, nine floats per element row. */
  readonly values: Float32Array;
}

/**
 * Number of scalar components each shape stores per entity.
 * @category Results
 */
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
 *   (the field does not copy the model, it is index-aligned to it). Imported
 *   elemental fields retain their stable source-id mapping privately while
 *   storing rows densely.
 * - Missing values are encoded as `NaN` anywhere a component is unknown. All
 *   range helpers skip `NaN` rather than treating it as zero.
 * - `unit` is an opaque, human-readable unit string ("mm", "MPa", ...). The
 *   library never converts units.
 *
 * `values` is referenced, not copied, so it stays cheap for large models.
 * Treat the returned field (and its array) as immutable after construction.
 * The `count`/length contract provides structural coverage; it does not require
 * every authored value to be finite. `NaN` remains an explicit missing value,
 * including for an entity that is rendered.
 * @category Results
 */
export interface ResultField<S extends FieldShape, L extends FieldLocation> {
  /** Stable, application-addressable identifier. */
  readonly id: string;
  /** Human-readable display name, e.g. "Temperature" or "Authored stress". */
  readonly name: string;
  /** Whether values are authored at nodes or elements. */
  readonly location: L;
  /** Scalar or three-component vector values. */
  readonly shape: S;
  /** Number of entities (nodes or elements) the field describes. */
  readonly count: number;
  /** Opaque unit string shared by every value in the field. */
  readonly unit: string;
  /** `count * FIELD_COMPONENT_COUNT[shape]` floats; `NaN` marks missing values. */
  readonly values: Float32Array;
}

/**
 * A scalar field over nodes or elements.
 * @category Results
 */
export type ScalarField<L extends FieldLocation> = ResultField<"scalar", L>;

/**
 * A three-component vector field over nodes or elements.
 * @category Results
 */
export type VectorField<L extends FieldLocation> = ResultField<"vector", L>;

/**
 * Any scalar or vector field at either location.
 * @category Results
 */
export type AnyResultField =
  ResultField<FieldShape, FieldLocation> | ElementFrameField | NodalLoadField;

interface ElementalResultSource {
  readonly ordinalById: ReadonlyMap<number, number>;
}

const elementalResultSources = new WeakMap<object, ElementalResultSource>();

/** Registers stable source identities for an imported elemental field. */
export function registerElementalResultSource(
  field: ResultField<FieldShape, "elemental">,
  elementIds: readonly number[],
): void {
  const ordinalById = new Map<number, number>();
  elementIds.forEach((elementId, ordinal) => ordinalById.set(elementId, ordinal));
  elementalResultSources.set(field, { ordinalById });
}

/** Resolves a stable element id to a dense field row at a private boundary. */
export function elementalResultIndex(
  field: { readonly count: number },
  elementId: number,
  elementOrdinal: number,
  elementCount: number,
  densePartLocal = true,
): number | undefined {
  const source = elementalResultSources.get(field);
  if (source !== undefined) return source.ordinalById.get(elementId);
  if (densePartLocal && field.count === elementCount) return elementOrdinal;
  return elementId >= 0 && elementId < field.count ? elementId : undefined;
}

/**
 * Inputs for {@link createResultField}.
 *
 * `count` is the number of addressable model entities, not the number of finite
 * values. Elemental fields authored directly for a part use its dense element
 * order; imported elemental fields are compiled densely from stable source ids.
 * Individual entries may still be `NaN` when the source result is missing.
 * @category Results
 */
export interface ResultFieldOptions<S extends FieldShape, L extends FieldLocation> {
  /** Stable application-addressable field identifier. */
  readonly id: string;
  /** Human-readable field name. */
  readonly name: string;
  /** Whether values are authored at nodes or elements. */
  readonly location: L;
  /** Scalar or three-component vector values. */
  readonly shape: S;
  /** Number of entities addressed by the field. */
  readonly count: number;
  /** Opaque unit label supplied by the host. */
  readonly unit: string;
  /** `count * FIELD_COMPONENT_COUNT[shape]` floats; `NaN` marks missing data. */
  readonly values: Float32Array;
}

/**
 * Creates a typed result field after validating the id, name, unit, entity
 * count, and value length. The value array is referenced, not copied; prepare
 * and fill it before calling this function, then treat both the field and its
 * array as immutable. Missing values should be encoded as `NaN`, not zero.
 * @example Author a nodal scalar snapshot for a four-node model.
 * ```ts
 * import { createResultField, scalarRange } from "femgx";
 *
 * const temperature = createResultField({
 *   id: "temperature-step-1",
 *   name: "Temperature",
 *   location: "nodal",
 *   shape: "scalar",
 *   count: 4,
 *   unit: "degC",
 *   values: new Float32Array([20, 40, Number.NaN, 30]),
 * });
 * const range = scalarRange(temperature); // finite values only
 * ```
 * @category Results
 */
export function createResultField<S extends FieldShape, L extends FieldLocation>(
  options: ResultFieldOptions<S, L>,
): ResultField<S, L> {
  validateResultField(options);
  return { ...options };
}

/** Creates a validated authored elemental X/Y/Z frame field. */
export function createElementFrameField(options: ElementFrameFieldOptions): ElementFrameField {
  if (options.id.length === 0) throw new Error("Element frame field id must not be empty");
  if (options.name.length === 0) throw new Error("Element frame field name must not be empty");
  if (!Number.isInteger(options.count) || options.count < 0) {
    throw new Error(
      `Element frame field count must be a non-negative integer, got ${options.count}`,
    );
  }
  if (options.unit.length === 0) throw new Error("Element frame field unit must not be empty");
  const expected = options.count * FRAME_COMPONENT_COUNT;
  if (options.values.length !== expected) {
    throw new Error(
      `Element frame field ${options.id} expects ${expected} values but got ${options.values.length}`,
    );
  }
  for (let element = 0; element < options.count; element += 1) {
    const base = element * FRAME_COMPONENT_COUNT;
    const row = options.values.subarray(base, base + FRAME_COMPONENT_COUNT);
    const missing = row.some((value) => !Number.isFinite(value));
    if (missing) continue;
    const x = Math.hypot(row[0] ?? 0, row[1] ?? 0, row[2] ?? 0);
    const y = Math.hypot(row[3] ?? 0, row[4] ?? 0, row[5] ?? 0);
    const z = Math.hypot(row[6] ?? 0, row[7] ?? 0, row[8] ?? 0);
    if (x <= 1e-12 || y <= 1e-12 || z <= 1e-12) {
      throw new Error(`Element frame field ${options.id} has a zero axis at element ${element}`);
    }
  }
  return { ...options, location: "elemental", shape: "frame" };
}

/** Creates a validated authored six-component nodal load field. */
export function createNodalLoadField(options: NodalLoadFieldOptions): NodalLoadField {
  if (options.id.length === 0) throw new Error("Nodal load field id must not be empty");
  if (options.name.length === 0) throw new Error("Nodal load field name must not be empty");
  if (!Number.isInteger(options.count) || options.count < 0) {
    throw new Error(`Nodal load field count must be a non-negative integer, got ${options.count}`);
  }
  if (options.forceUnit.length === 0)
    throw new Error("Nodal load field forceUnit must not be empty");
  if (options.momentUnit.length === 0)
    throw new Error("Nodal load field momentUnit must not be empty");
  const expected = options.count * LOAD_COMPONENT_COUNT;
  if (options.values.length !== expected) {
    throw new Error(
      `Nodal load field ${options.id} expects ${expected} values but got ${options.values.length}`,
    );
  }
  for (let node = 0; node < options.count; node += 1) {
    validateLoadVector(options.values, node * LOAD_COMPONENT_COUNT, options.id, node, "force");
    validateLoadVector(options.values, node * LOAD_COMPONENT_COUNT + 3, options.id, node, "moment");
  }
  return { ...options, location: "nodal", shape: "load" };
}

function validateLoadVector(
  values: Float32Array,
  base: number,
  id: string,
  node: number,
  name: string,
): void {
  const finite = [0, 1, 2].map((offset) => Number.isFinite(values[base + offset]));
  if (finite.some(Boolean) && !finite.every(Boolean)) {
    throw new Error(
      `Nodal load field ${id} has a mixed finite/missing ${name} vector at node ${node}`,
    );
  }
}

/** Returns one element's authored X/Y/Z axes, or NaNs for a missing row. */
export function frameAt(
  field: ElementFrameField,
  entity: number,
): readonly [number, number, number, number, number, number, number, number, number] {
  if (!Number.isInteger(entity) || entity < 0 || entity >= field.count) {
    throw new Error(
      `Entity ${entity} is out of range for element frame field ${field.id} (count ${field.count})`,
    );
  }
  const base = entity * FRAME_COMPONENT_COUNT;
  return [
    field.values[base] ?? NaN,
    field.values[base + 1] ?? NaN,
    field.values[base + 2] ?? NaN,
    field.values[base + 3] ?? NaN,
    field.values[base + 4] ?? NaN,
    field.values[base + 5] ?? NaN,
    field.values[base + 6] ?? NaN,
    field.values[base + 7] ?? NaN,
    field.values[base + 8] ?? NaN,
  ];
}

/**
 * Returns the scalar value of an entity, or `NaN` when it is missing.
 * @category Results
 */
export function scalarAt<L extends FieldLocation>(
  field: ResultField<"scalar", L>,
  entity: number,
): number {
  return field.values[assertEntity(field, entity)] ?? NaN;
}

/**
 * Returns the three vector components of an entity (may contain `NaN`).
 * @category Results
 */
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
