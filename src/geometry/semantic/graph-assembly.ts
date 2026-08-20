import { ordinalForId } from "../../elements/model-storage";
import type { PartElementColumns } from "./direct-element-columns";
import type { EdgeColumns } from "./edge-columns";
import type { FaceColumns } from "./face-columns";
import type { PartBodyColumns } from "./model-body-columns";
import type { PartSemanticGraph } from "./part-semantic-graph";

/** Assembles the one canonical graph after direct columns have been completed. */
export function assemblePartSemanticGraph(input: {
  readonly geometryCount: number;
  readonly elements: PartElementColumns;
  readonly bodies: PartBodyColumns;
  readonly faces: FaceColumns;
  readonly edges: EdgeColumns;
  readonly faceSubset: {
    readonly offsets: Uint32Array;
    readonly ordinals: Uint32Array;
    readonly defined: Uint8Array;
  };
}): PartSemanticGraph {
  const { geometryCount, elements, bodies, faces, edges, faceSubset } = input;
  return {
    ...elements,
    ...bodies,
    ...faces,
    ...edges,
    faceGeometryOffsets: geometryOffsets(geometryCount, faces.faceGeometryOrdinals),
    edgeGeometryOffsets: geometryOffsets(geometryCount, edges.edgeGeometryOrdinals),
    surfaceBodyIds: triangleBodyIds(elements, bodies),
    faceSubsetOffsets: faceSubset.offsets,
    faceSubsetOrdinals: faceSubset.ordinals,
    faceSubsetDefined: faceSubset.defined,
  };
}

function geometryOffsets(geometryCount: number, ordinals: Uint8Array): Uint32Array {
  const offsets = new Uint32Array(geometryCount + 1);
  for (const ordinal of ordinals) offsets[ordinal + 1] = (offsets[ordinal + 1] ?? 0) + 1;
  for (let ordinal = 1; ordinal < offsets.length; ordinal += 1) {
    offsets[ordinal] = (offsets[ordinal] ?? 0) + (offsets[ordinal - 1] ?? 0);
  }
  return offsets;
}

function triangleBodyIds(
  elements: {
    readonly elementBodyIds: Uint32Array;
    readonly elementRangeOffsets: Uint32Array;
    readonly elementRangePrimitiveCodes: Uint8Array;
  },
  bodies: { readonly bodyIds: Uint32Array; readonly bodyIdOrdinals: Uint32Array },
): Uint32Array {
  const included = new Uint8Array(bodies.bodyIds.length);
  for (let element = 0; element < elements.elementBodyIds.length; element += 1) {
    const body = elements.elementBodyIds[element] ?? 0;
    if (body === 0) continue;
    const first = elements.elementRangeOffsets[element] ?? 0;
    const last = elements.elementRangeOffsets[element + 1] ?? first;
    for (let range = first; range < last; range += 1) {
      if (elements.elementRangePrimitiveCodes[range] !== 0) continue;
      const ordinal = ordinalForId(bodies.bodyIds, bodies.bodyIdOrdinals, body);
      if (ordinal !== undefined) included[ordinal] = 1;
      break;
    }
  }
  let count = 0;
  for (const value of included) count += value;
  const result = new Uint32Array(count);
  let output = 0;
  for (let ordinal = 0; ordinal < included.length; ordinal += 1) {
    if (included[ordinal] === 1) result[output++] = bodies.bodyIds[ordinal] ?? 0;
  }
  result.sort();
  return result;
}
