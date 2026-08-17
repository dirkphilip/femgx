import type { Part } from "../geometry/part";
import type { ElementFrameField, VectorField } from "./fields";
import { getOrientationTopology, resolveOrientationAnchor } from "./orientation-topology";

/** The deterministic threshold below which an authored direction is omitted. */
const VECTOR_ZERO_TOLERANCE = 1e-12;

/**
 * Packed per-part data for future instanced elemental orientation rendering.
 *
 * `bodyIds` stores `bodyId + 1`; zero means that the element has no body. The
 * remaining arrays are structure-of-arrays storage with one row per element
 * id, and xyz arrays use three consecutive values per row.
 */
export interface ElementalOrientationRecords {
  readonly elementIds: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly anchors: Float32Array;
  readonly referenceLengths: Float32Array;
  readonly directions: Float32Array;
  /** RGB axis index per record; zero for ordinary vector glyph records. */
  readonly axisIndices?: Uint32Array;
  /** Per-record glyph mode: 0 arrow, 1 axis, 2 triad, 3 arc segment. */
  readonly glyphModes?: Uint32Array;
  /** Per-record normal transform flag; zero is direction, one is normal. */
  readonly transformModes?: Uint32Array;
  /** Optional per-record multiplier folded into the authored reference length. */
  readonly lengthScales?: Float32Array;
  readonly anchorDeltas: Float32Array | undefined;
}

interface CachedVectorRecords {
  readonly fieldCount: number;
  readonly records: ElementalOrientationRecords;
}

const vectorRecordCache = new WeakMap<Part, WeakMap<Float32Array, CachedVectorRecords>>();
const anchorDeltaCache = new WeakMap<
  Part,
  WeakMap<Float32Array, WeakMap<ElementalOrientationRecords, Float32Array>>
>();

/**
 * Resolves one authored elemental vector field into reusable per-part records.
 *
 * This is an internal CPU boundary for the future orientation renderer. It
 * validates authored coverage and anchorability only when a finite non-zero
 * row needs a glyph, so an all-missing/all-zero field resolves to an empty
 * state without requiring element metadata. The returned arrays are reused
 * for the same immutable part and field/displacement array references.
 */
export function resolveElementalOrientationRecords(
  part: Part,
  field: VectorField<"elemental">,
  displacements?: Float32Array,
): ElementalOrientationRecords {
  validateElementCoverage(part, field);

  const cached = vectorRecordsFor(part, field);
  if (displacements === undefined) return cached;
  const anchorDeltas = anchorDeltasFor(part, cached, displacements);
  return { ...cached, anchorDeltas };
}

/** Resolves an authored X/Y/Z frame into three renderer-owned axis records per element. */
export function resolveElementalFrameRecords(
  part: Part,
  field: ElementFrameField,
  displacements?: Float32Array,
): ElementalOrientationRecords {
  validateFrameCoverage(part, field);
  const topology = getOrientationTopology(part);
  const active = topology.elements.filter((element) => hasActiveFrameAt(field, element.id));
  const nodePositions = part.nodePositions;
  if (active.length > 0 && nodePositions === undefined) {
    throw new Error(
      `Element frame field ${field.id} cannot anchor part ${part.id}: geometry has no nodePositions`,
    );
  }
  if (nodePositions === undefined) return emptyRecords();
  const elementIds = new Uint32Array(active.length * 3);
  const bodyIds = new Uint32Array(active.length * 3);
  const anchors = new Float32Array(active.length * 9);
  const referenceLengths = new Float32Array(active.length * 3);
  const directions = new Float32Array(active.length * 9);
  const axisIndices = new Uint32Array(active.length * 3);
  active.forEach((element, elementIndex) => {
    const anchor = resolveOrientationAnchor(part, field, element, nodePositions);
    const fieldBase = element.id * 9;
    for (let axis = 0; axis < 3; axis += 1) {
      const recordIndex = elementIndex * 3 + axis;
      const recordBase = recordIndex * 3;
      const axisBase = fieldBase + axis * 3;
      elementIds[recordIndex] = element.id;
      bodyIds[recordIndex] = element.bodyId === undefined ? 0 : element.bodyId + 1;
      axisIndices[recordIndex] = axis;
      anchors[recordBase] = anchor.x;
      anchors[recordBase + 1] = anchor.y;
      anchors[recordBase + 2] = anchor.z;
      referenceLengths[recordIndex] = anchor.referenceLength;
      const length = Math.hypot(
        field.values[axisBase] ?? NaN,
        field.values[axisBase + 1] ?? NaN,
        field.values[axisBase + 2] ?? NaN,
      );
      directions[recordBase] = (field.values[axisBase] ?? NaN) / length;
      directions[recordBase + 1] = (field.values[axisBase + 1] ?? NaN) / length;
      directions[recordBase + 2] = (field.values[axisBase + 2] ?? NaN) / length;
    }
  });
  const records = {
    elementIds,
    bodyIds,
    anchors,
    referenceLengths,
    directions,
    axisIndices,
    anchorDeltas: undefined,
  };
  return displacements === undefined
    ? records
    : { ...records, anchorDeltas: anchorDeltasFor(part, records, displacements) };
}

function validateElementCoverage(part: Part, field: VectorField<"elemental">): void {
  const elements = part.elements;
  if (elements === undefined || elements.length === 0) {
    if (hasActiveVector(field)) {
      throw new Error(
        `Elemental orientation field ${field.id} cannot resolve part ${part.id}: geometry has no element metadata`,
      );
    }
    return;
  }
  for (const element of elements) {
    if (element.id >= field.count) {
      throw new Error(
        `Elemental orientation field ${field.id} (count ${field.count}) has no value for element ${element.id} in part ${part.id}`,
      );
    }
  }
}

function validateFrameCoverage(part: Part, field: ElementFrameField): void {
  const elements = part.elements;
  if (elements === undefined || elements.length === 0) {
    if (hasActiveFrame(field)) {
      throw new Error(
        `Element frame field ${field.id} cannot resolve part ${part.id}: geometry has no element metadata`,
      );
    }
    return;
  }
  for (const element of elements) {
    if (element.id >= field.count) {
      throw new Error(
        `Element frame field ${field.id} (count ${field.count}) has no value for element ${element.id} in part ${part.id}`,
      );
    }
  }
}

function hasActiveFrame(field: ElementFrameField): boolean {
  for (let element = 0; element < field.count; element += 1) {
    if (hasActiveFrameAt(field, element)) return true;
  }
  return false;
}

function vectorRecordsFor(
  part: Part,
  field: VectorField<"elemental">,
): ElementalOrientationRecords {
  let fields = vectorRecordCache.get(part);
  if (fields === undefined) {
    fields = new WeakMap<Float32Array, CachedVectorRecords>();
    vectorRecordCache.set(part, fields);
  }
  const cached = fields.get(field.values);
  if (cached !== undefined && cached.fieldCount === field.count) return cached.records;

  const records = buildVectorRecords(part, field);
  fields.set(field.values, { fieldCount: field.count, records });
  return records;
}

function buildVectorRecords(
  part: Part,
  field: VectorField<"elemental">,
): ElementalOrientationRecords {
  const topology = getOrientationTopology(part);
  const active = topology.elements.filter((element) => hasActiveVectorAt(field, element.id));
  const nodePositions = part.nodePositions;
  if (active.length > 0 && nodePositions === undefined) {
    throw new Error(
      `Elemental orientation field ${field.id} cannot anchor part ${part.id}: geometry has no nodePositions`,
    );
  }
  if (nodePositions === undefined) return emptyRecords();

  const elementIds = new Uint32Array(active.length);
  const bodyIds = new Uint32Array(active.length);
  const anchors = new Float32Array(active.length * 3);
  const referenceLengths = new Float32Array(active.length);
  const directions = new Float32Array(active.length * 3);

  active.forEach((element, index) => {
    const anchor = resolveOrientationAnchor(part, field, element, nodePositions);
    const base = index * 3;
    const vectorBase = element.id * 3;
    const x = field.values[vectorBase] ?? NaN;
    const y = field.values[vectorBase + 1] ?? NaN;
    const z = field.values[vectorBase + 2] ?? NaN;
    const length = Math.hypot(x, y, z);
    elementIds[index] = element.id;
    bodyIds[index] = element.bodyId === undefined ? 0 : element.bodyId + 1;
    anchors[base] = anchor.x;
    anchors[base + 1] = anchor.y;
    anchors[base + 2] = anchor.z;
    referenceLengths[index] = anchor.referenceLength;
    directions[base] = x / length;
    directions[base + 1] = y / length;
    directions[base + 2] = z / length;
  });

  return {
    elementIds,
    bodyIds,
    anchors,
    referenceLengths,
    directions,
    anchorDeltas: undefined,
  };
}

function emptyRecords(): ElementalOrientationRecords {
  return {
    elementIds: new Uint32Array(),
    bodyIds: new Uint32Array(),
    anchors: new Float32Array(),
    referenceLengths: new Float32Array(),
    directions: new Float32Array(),
    axisIndices: new Uint32Array(),
    anchorDeltas: undefined,
  };
}

function anchorDeltasFor(
  part: Part,
  records: ElementalOrientationRecords,
  displacements: Float32Array,
): Float32Array {
  let deltas = anchorDeltaCache.get(part);
  if (deltas === undefined) {
    deltas = new WeakMap<Float32Array, WeakMap<ElementalOrientationRecords, Float32Array>>();
    anchorDeltaCache.set(part, deltas);
  }
  let recordsDeltas = deltas.get(displacements);
  if (recordsDeltas === undefined) {
    recordsDeltas = new WeakMap<ElementalOrientationRecords, Float32Array>();
    deltas.set(displacements, recordsDeltas);
  }
  const cached = recordsDeltas.get(records);
  if (cached !== undefined) return cached;

  const topology = getOrientationTopology(part);
  const result = new Float32Array(records.elementIds.length * 3);
  for (let index = 0; index < records.elementIds.length; index += 1) {
    const elementId = records.elementIds[index];
    if (elementId === undefined) throw new Error(`Elemental orientation record ${index} has no id`);
    const element = topology.byId.get(elementId);
    if (element === undefined)
      throw new Error(`Element ${elementId} is missing from part topology`);
    const base = index * 3;
    for (const nodeId of element.nodeIds) {
      const source = nodeId * 3;
      result[base] = (result[base] ?? 0) + finiteOrZero(displacements[source]);
      result[base + 1] = (result[base + 1] ?? 0) + finiteOrZero(displacements[source + 1]);
      result[base + 2] = (result[base + 2] ?? 0) + finiteOrZero(displacements[source + 2]);
    }
    const divisor = element.nodeIds.length;
    result[base] = (result[base] ?? 0) / divisor;
    result[base + 1] = (result[base + 1] ?? 0) / divisor;
    result[base + 2] = (result[base + 2] ?? 0) / divisor;
  }
  recordsDeltas.set(records, result);
  return result;
}

function hasActiveVector(field: VectorField<"elemental">): boolean {
  for (let element = 0; element < field.count; element += 1) {
    if (hasActiveVectorAt(field, element)) return true;
  }
  return false;
}

function hasActiveVectorAt(field: VectorField<"elemental">, element: number): boolean {
  const base = element * 3;
  const x = field.values[base] ?? NaN;
  const y = field.values[base + 1] ?? NaN;
  const z = field.values[base + 2] ?? NaN;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(z) &&
    Math.hypot(x, y, z) > VECTOR_ZERO_TOLERANCE
  );
}

function hasActiveFrameAt(field: ElementFrameField, element: number): boolean {
  const base = element * 9;
  return [0, 1, 2].every((axis) => {
    const axisBase = base + axis * 3;
    const x = field.values[axisBase] ?? NaN;
    const y = field.values[axisBase + 1] ?? NaN;
    const z = field.values[axisBase + 2] ?? NaN;
    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z) &&
      Math.hypot(x, y, z) > VECTOR_ZERO_TOLERANCE
    );
  });
}

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}
