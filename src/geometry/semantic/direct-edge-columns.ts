import { ordinalForId } from "../../elements/model-storage";
import { completeEdgeColumns, type EdgeColumns } from "./edge-columns";

/** Typed authored-edge source rows before stable ids are resolved to ordinals. */
export interface DirectEdgeSources {
  readonly geometryOrdinals: Uint8Array;
  readonly nodeOffsets: Uint32Array;
  readonly nodeIds: Uint32Array;
  readonly incidentOffsets: Uint32Array;
  readonly incidentElementIds: Uint32Array;
  readonly faceOffsets: Uint32Array;
  readonly faceElementIds: Uint32Array;
  readonly faceIndices: Uint32Array;
}

/** Resolves source ids in one pass after element columns establish stable ordinals. */
export function resolveDirectEdgeColumns(
  source: DirectEdgeSources,
  ids: Uint32Array,
  ordinals: Uint32Array,
): EdgeColumns {
  return completeEdgeColumns({
    edgeGeometryOrdinals: source.geometryOrdinals,
    edgeNodeOffsets: source.nodeOffsets,
    edgeNodeIds: source.nodeIds,
    edgeIncidentOffsets: source.incidentOffsets,
    edgeIncidentElementOrdinals: resolveIds(source.incidentElementIds, ids, ordinals, "Edge"),
    edgeFaceOffsets: source.faceOffsets,
    edgeFaceOwnerElementOrdinals: resolveIds(source.faceElementIds, ids, ordinals, "Edge face"),
    edgeFaceIndices: source.faceIndices,
  });
}

function resolveIds(
  values: Uint32Array,
  ids: Uint32Array,
  ordinals: Uint32Array,
  label: string,
): Uint32Array {
  const result = new Uint32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index] ?? 0;
    const ordinal = ordinalForId(ids, ordinals, id);
    if (ordinal === undefined) throw new Error(`${label} references unknown element ${id}`);
    result[index] = ordinal;
  }
  return result;
}
