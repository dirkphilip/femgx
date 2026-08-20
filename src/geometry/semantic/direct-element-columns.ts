import { ordinalForId } from "../../elements/model-storage";
import type { GeometryInput } from "../types";
import { primitiveCode } from "./part-semantic-graph";

/** One primitive range per model ordinal emitted by a direct mesh compiler. */
export interface ElementSemanticFragment {
  readonly primitive: GeometryInput["primitive"];
  readonly elementIds: Uint32Array;
  readonly primitiveStarts: Uint32Array;
  readonly primitiveCounts: Uint32Array;
}

/** Canonical element columns emitted by a direct Part compiler. */
export interface PartElementColumns {
  readonly elementIds: Uint32Array;
  readonly elementIdOrdinals: Uint32Array;
  readonly elementShapeCodes: Uint8Array;
  readonly elementBodyIds: Uint32Array;
  readonly elementRangeOffsets: Uint32Array;
  readonly elementRangeGeometryOrdinals: Uint8Array;
  readonly elementRangePrimitiveCodes: Uint8Array;
  readonly elementRangeStarts: Uint32Array;
  readonly elementRangeCounts: Uint32Array;
}

/** Packs direct primitive fragments into element CSR columns without descriptor objects. */
export function buildPartElementColumnsFromFragments(
  geometries: readonly GeometryInput[],
  fragments: readonly ElementSemanticFragment[],
  bodyIdForElement: (id: number) => number | undefined = () => undefined,
): PartElementColumns {
  const elementIds = uniqueFragmentElementIds(fragments);
  const elementIdOrdinals = ordinalColumns(elementIds.length);
  const counts = countRangesByElement(fragments, elementIds, elementIdOrdinals);
  const elementRangeOffsets = rangeOffsets(counts);
  const elementBodyIds = bodyIds(elementIds, bodyIdForElement);
  return {
    elementIds,
    elementIdOrdinals,
    elementShapeCodes: new Uint8Array(elementIds.length),
    elementBodyIds,
    elementRangeOffsets,
    ...rangeColumns(geometries, fragments, elementIds, elementIdOrdinals, elementRangeOffsets),
  };
}

function uniqueFragmentElementIds(fragments: readonly ElementSemanticFragment[]): Uint32Array {
  let rangeCount = 0;
  for (const fragment of fragments) rangeCount += fragment.elementIds.length;
  const ids = new Uint32Array(rangeCount);
  let cursor = 0;
  for (const fragment of fragments) {
    ids.set(fragment.elementIds, cursor);
    cursor += fragment.elementIds.length;
  }
  ids.sort();
  let count = 0;
  for (let index = 0; index < ids.length; index += 1) {
    if (index === 0 || ids[index] !== ids[index - 1]) ids[count++] = ids[index] ?? 0;
  }
  return ids.slice(0, count);
}

function ordinalColumns(count: number): Uint32Array {
  const ordinals = new Uint32Array(count);
  for (let ordinal = 0; ordinal < count; ordinal += 1) ordinals[ordinal] = ordinal;
  return ordinals;
}

function countRangesByElement(
  fragments: readonly ElementSemanticFragment[],
  ids: Uint32Array,
  ordinals: Uint32Array,
): Uint32Array {
  const counts = new Uint32Array(ids.length);
  for (const fragment of fragments) {
    validateFragment(fragment);
    for (const id of fragment.elementIds) {
      const ordinal = ordinalForId(ids, ordinals, id);
      if (ordinal === undefined) throw new Error(`Direct compiler has unknown element ${id}`);
      counts[ordinal] = (counts[ordinal] ?? 0) + 1;
    }
  }
  return counts;
}

function rangeOffsets(counts: Uint32Array): Uint32Array {
  const offsets = new Uint32Array(counts.length + 1);
  for (let ordinal = 0; ordinal < counts.length; ordinal += 1) {
    offsets[ordinal + 1] = (offsets[ordinal] ?? 0) + (counts[ordinal] ?? 0);
  }
  return offsets;
}

function bodyIds(
  ids: Uint32Array,
  bodyIdForElement: (id: number) => number | undefined,
): Uint32Array {
  const result = new Uint32Array(ids.length);
  for (let ordinal = 0; ordinal < ids.length; ordinal += 1) {
    result[ordinal] = bodyIdForElement(ids[ordinal] ?? 0) ?? 0;
  }
  return result;
}

function rangeColumns(
  geometries: readonly GeometryInput[],
  fragments: readonly ElementSemanticFragment[],
  ids: Uint32Array,
  ordinals: Uint32Array,
  offsets: Uint32Array,
): Pick<
  PartElementColumns,
  | "elementRangeGeometryOrdinals"
  | "elementRangePrimitiveCodes"
  | "elementRangeStarts"
  | "elementRangeCounts"
> {
  const count = offsets[offsets.length - 1] ?? 0;
  const geometryOrdinals = new Uint8Array(count);
  const primitiveCodes = new Uint8Array(count);
  const starts = new Uint32Array(count);
  const counts = new Uint32Array(count);
  const cursors = new Uint32Array(offsets.subarray(0, offsets.length - 1));
  for (const fragment of fragments) {
    const geometry = geometryOrdinal(geometries, fragment.primitive);
    for (let index = 0; index < fragment.elementIds.length; index += 1) {
      const ordinal = ordinalForId(ids, ordinals, fragment.elementIds[index] ?? 0);
      if (ordinal === undefined) throw new Error("Direct compiler has an invalid element range");
      const range = cursors[ordinal] ?? 0;
      geometryOrdinals[range] = geometry;
      primitiveCodes[range] = primitiveCode(fragment.primitive);
      starts[range] = fragment.primitiveStarts[index] ?? 0;
      counts[range] = fragment.primitiveCounts[index] ?? 0;
      cursors[ordinal] = range + 1;
    }
  }
  return {
    elementRangeGeometryOrdinals: geometryOrdinals,
    elementRangePrimitiveCodes: primitiveCodes,
    elementRangeStarts: starts,
    elementRangeCounts: counts,
  };
}

function validateFragment(fragment: ElementSemanticFragment): void {
  if (
    fragment.primitiveStarts.length !== fragment.elementIds.length ||
    fragment.primitiveCounts.length !== fragment.elementIds.length
  ) {
    throw new Error("Direct compiler fragment columns have inconsistent lengths");
  }
}

function geometryOrdinal(
  geometries: readonly GeometryInput[],
  primitive: GeometryInput["primitive"],
): number {
  for (let ordinal = 0; ordinal < geometries.length; ordinal += 1) {
    if (geometries[ordinal]?.primitive === primitive) return ordinal;
  }
  throw new Error(`Part has no ${primitive} geometry`);
}
