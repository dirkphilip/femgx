import { ordinalForId } from "../../elements/model-storage";
import { completeFaceColumns, type FaceColumns } from "./face-columns";

/** Typed face rows before stable element ids are resolved to graph ordinals. */
export interface DirectFaceSources {
  readonly geometryOrdinals: Uint8Array;
  readonly elementIds: Uint32Array;
  readonly faceIndices: Uint32Array;
  readonly primitiveStarts: Uint32Array;
  readonly primitiveCounts: Uint32Array;
  readonly neighborElementIds: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly nodeOffsets: Uint32Array;
  readonly nodeIds: Uint32Array;
}

/** Resolves direct face source ids after the part element columns are established. */
export function resolveDirectFaceColumns(
  source: DirectFaceSources,
  ids: Uint32Array,
  ordinals: Uint32Array,
): FaceColumns {
  const count = source.elementIds.length;
  const owners = new Uint32Array(count);
  const neighbors = new Uint32Array(count);
  const missing = new Uint8Array(count);
  const missingIds = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    const id = source.elementIds[index] ?? 0;
    const owner = ordinalForId(ids, ordinals, id);
    if (owner === undefined) throw new Error(`Face references unknown element ${id}`);
    owners[index] = owner;
    const neighborId = source.neighborElementIds[index] ?? 0;
    if (neighborId === 0) continue;
    const neighbor = ordinalForId(ids, ordinals, neighborId);
    if (neighbor === undefined) {
      missing[index] = 1;
      missingIds[index] = neighborId;
    } else {
      neighbors[index] = neighbor + 1;
    }
  }
  return completeFaceColumns({
    faceGeometryOrdinals: source.geometryOrdinals,
    faceOwnerElementOrdinals: owners,
    faceIndices: source.faceIndices,
    facePrimitiveStarts: source.primitiveStarts,
    facePrimitiveCounts: source.primitiveCounts,
    faceNeighborElementOrdinals: neighbors,
    faceNeighborMissing: missing,
    faceNeighborMissingIds: missingIds,
    faceBodyIds: source.bodyIds,
    faceNodeOffsets: source.nodeOffsets,
    faceNodeIds: source.nodeIds,
  });
}
