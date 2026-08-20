import { ordinalForId } from "../../elements/model-storage";
import type { GeometryInput } from "../types";

export interface FaceColumns {
  readonly faceGeometryOrdinals: Uint8Array;
  readonly faceOwnerElementOrdinals: Uint32Array;
  readonly faceIndices: Uint32Array;
  readonly facePrimitiveStarts: Uint32Array;
  readonly facePrimitiveCounts: Uint32Array;
  readonly faceNeighborElementOrdinals: Uint32Array;
  readonly faceNeighborMissing: Uint8Array;
  readonly faceNeighborMissingIds: Uint32Array;
  readonly faceBodyIds: Uint32Array;
  readonly faceNodeOffsets: Uint32Array;
  readonly faceNodeIds: Uint32Array;
  readonly faceLookupOrdinals: Uint32Array;
}

/** Builds face columns without retaining face descriptor records. */
export function buildFaceColumns(
  geometries: readonly GeometryInput[],
  elementIds: Uint32Array,
  elementIdOrdinals: Uint32Array,
): FaceColumns {
  const sizes = faceColumnSizes(geometries);
  const columns = allocateFaceColumns(sizes.faces, sizes.nodes);
  fillFaceColumns(columns, geometries, elementIds, elementIdOrdinals);
  return completeFaceColumns(columns);
}

/** Completes direct compiler face columns with their typed lookup index. */
export function completeFaceColumns(columns: Omit<FaceColumns, "faceLookupOrdinals">): FaceColumns {
  return { ...columns, faceLookupOrdinals: sortedFaceOrdinals(columns) };
}

function sortedFaceOrdinals(columns: Omit<FaceColumns, "faceLookupOrdinals">): Uint32Array {
  const result = new Uint32Array(columns.faceIndices.length);
  const scratch = new Uint32Array(result.length);
  for (let index = 0; index < result.length; index += 1) result[index] = index;
  for (let width = 1; width < result.length; width *= 2) {
    for (let start = 0; start < result.length; start += width * 2) {
      const middle = Math.min(start + width, result.length);
      const end = Math.min(start + width * 2, result.length);
      let left = start;
      let right = middle;
      for (let output = start; output < end; output += 1) {
        const leftOrdinal = result[left] ?? 0;
        const rightOrdinal = result[right] ?? 0;
        if (left < middle && (right >= end || beforeFace(columns, leftOrdinal, rightOrdinal))) {
          scratch[output] = leftOrdinal;
          left += 1;
        } else {
          scratch[output] = rightOrdinal;
          right += 1;
        }
      }
    }
    result.set(scratch);
  }
  return result;
}

function beforeFace(
  columns: Omit<FaceColumns, "faceLookupOrdinals">,
  left: number,
  right: number,
): boolean {
  const leftOwner = columns.faceOwnerElementOrdinals[left] ?? 0;
  const rightOwner = columns.faceOwnerElementOrdinals[right] ?? 0;
  return leftOwner === rightOwner
    ? (columns.faceIndices[left] ?? 0) <= (columns.faceIndices[right] ?? 0)
    : leftOwner < rightOwner;
}

function faceColumnSizes(geometries: readonly GeometryInput[]): {
  readonly faces: number;
  readonly nodes: number;
} {
  let faces = 0;
  let nodes = 0;
  for (const geometry of geometries) {
    if (geometry.primitive !== "triangles") continue;
    faces += geometry.faces?.length ?? 0;
    for (const face of geometry.faces ?? []) nodes += face.nodeIds.length;
  }
  return { faces, nodes };
}

function allocateFaceColumns(
  faceCount: number,
  nodeCount: number,
): Omit<FaceColumns, "faceLookupOrdinals"> {
  return {
    faceGeometryOrdinals: new Uint8Array(faceCount),
    faceOwnerElementOrdinals: new Uint32Array(faceCount),
    faceIndices: new Uint32Array(faceCount),
    facePrimitiveStarts: new Uint32Array(faceCount),
    facePrimitiveCounts: new Uint32Array(faceCount),
    faceNeighborElementOrdinals: new Uint32Array(faceCount),
    faceNeighborMissing: new Uint8Array(faceCount),
    faceNeighborMissingIds: new Uint32Array(faceCount),
    faceBodyIds: new Uint32Array(faceCount),
    faceNodeOffsets: new Uint32Array(faceCount + 1),
    faceNodeIds: new Uint32Array(nodeCount),
  };
}

function fillFaceColumns(
  columns: Omit<FaceColumns, "faceLookupOrdinals">,
  geometries: readonly GeometryInput[],
  elementIds: Uint32Array,
  elementIdOrdinals: Uint32Array,
): void {
  const cursor = { face: 0, node: 0 };
  for (let geometryOrdinal = 0; geometryOrdinal < geometries.length; geometryOrdinal += 1) {
    const geometry = geometries[geometryOrdinal];
    if (geometry?.primitive !== "triangles") continue;
    for (const face of geometry.faces ?? []) {
      fillFace(columns, cursor, geometryOrdinal, face, {
        ids: elementIds,
        ordinals: elementIdOrdinals,
      });
    }
  }
  columns.faceNodeOffsets[cursor.face] = cursor.node;
}

function fillFace(
  columns: Omit<FaceColumns, "faceLookupOrdinals">,
  cursor: { face: number; node: number },
  geometryOrdinal: number,
  face: NonNullable<Extract<GeometryInput, { primitive: "triangles" }>["faces"]>[number],
  lookup: { readonly ids: Uint32Array; readonly ordinals: Uint32Array },
): void {
  const owner = ordinalForId(lookup.ids, lookup.ordinals, face.elementId);
  if (owner === undefined) throw new Error(`Face references unknown element ${face.elementId}`);
  const neighbor =
    face.neighborElementId === undefined
      ? undefined
      : ordinalForId(lookup.ids, lookup.ordinals, face.neighborElementId);
  columns.faceGeometryOrdinals[cursor.face] = geometryOrdinal;
  columns.faceOwnerElementOrdinals[cursor.face] = owner;
  columns.faceIndices[cursor.face] = face.faceIndex;
  columns.facePrimitiveStarts[cursor.face] = face.primitiveStart;
  columns.facePrimitiveCounts[cursor.face] = face.primitiveCount;
  columns.faceNeighborElementOrdinals[cursor.face] = neighbor === undefined ? 0 : neighbor + 1;
  columns.faceNeighborMissing[cursor.face] =
    face.neighborElementId === undefined || neighbor !== undefined ? 0 : 1;
  columns.faceNeighborMissingIds[cursor.face] =
    neighbor === undefined ? (face.neighborElementId ?? 0) : 0;
  columns.faceBodyIds[cursor.face] = face.bodyId ?? 0;
  columns.faceNodeOffsets[cursor.face] = cursor.node;
  columns.faceNodeIds.set(face.nodeIds, cursor.node);
  cursor.node += face.nodeIds.length;
  cursor.face += 1;
}
