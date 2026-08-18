import type { Geometry } from "../../geometry/part";
import { primitiveIdsForSourceIndices } from "./surface-geometry";

/** Vertex and topology data uploaded for one renderer draw path. */
export interface UploadVertexData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
  readonly primitiveIds: Uint32Array;
  /** Source vertex for each draw corner; present for indexed triangle geometry. */
  readonly cornerIndices?: Uint32Array;
}

/** Builds sequential draw corners while retaining the source vertex topology. */
export function triangleUploadData(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  sourceIndices: Uint32Array = geometry.indices,
): UploadVertexData {
  const nodePickIds =
    geometry.nodePickIds ?? new Uint32Array(Math.floor(geometry.positions.length / 3));
  return {
    positions: geometry.positions,
    indices: sequentialIndices(sourceIndices.length),
    nodePickIds,
    primitiveIds: primitiveIdsForSourceIndices(geometry, sourceIndices),
    cornerIndices: sourceIndices,
  };
}

/** Builds a compact source-vertex table for an exterior face subset. */
export function triangleSubsetUploadData(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  sourceIndices: Uint32Array,
): UploadVertexData {
  const sourceVertexByIndex = new Map<number, number>();
  const compactIndices = new Uint32Array(sourceIndices.length);
  const positions: number[] = [];
  const nodePickIds: number[] = [];
  for (let corner = 0; corner < sourceIndices.length; corner += 1) {
    const sourceIndex = sourceIndices[corner] ?? 0;
    let compactIndex = sourceVertexByIndex.get(sourceIndex);
    if (compactIndex === undefined) {
      compactIndex = positions.length / 3;
      sourceVertexByIndex.set(sourceIndex, compactIndex);
      const positionOffset = sourceIndex * 3;
      positions.push(
        geometry.positions[positionOffset] ?? 0,
        geometry.positions[positionOffset + 1] ?? 0,
        geometry.positions[positionOffset + 2] ?? 0,
      );
      nodePickIds.push(geometry.nodePickIds?.[sourceIndex] ?? 0);
    }
    compactIndices[corner] = compactIndex;
  }
  return {
    positions: new Float32Array(positions),
    indices: sequentialIndices(sourceIndices.length),
    nodePickIds: new Uint32Array(nodePickIds),
    primitiveIds: primitiveIdsForSourceIndices(geometry, sourceIndices),
    cornerIndices: compactIndices,
  };
}

function sequentialIndices(count: number): Uint32Array {
  return Uint32Array.from({ length: count }, (_, index) => index);
}
