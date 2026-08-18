import type { PackedSemanticStorage } from "./packed-semantic";

export interface PackedTriangleSemanticCsr {
  readonly nodeTriangleFaceOffsets: Uint32Array;
  readonly nodeTriangleFaceIds: Uint32Array;
  readonly neighborTriangleFaceOffsets: Uint32Array;
  readonly neighborTriangleFaceIds: Uint32Array;
  readonly hasBoundaryFaceSubset: boolean;
  readonly hasCompleteNeighborTriangleIndex: boolean;
}

/** Builds packed node and neighbor face CSR indexes without face descriptors. */
export function buildPackedTriangleSemanticCsr(
  storage: PackedSemanticStorage,
): PackedTriangleSemanticCsr {
  const node = buildNodeCsr(storage);
  const hasBoundaryFaceSubset = packedBoundarySubset(storage);
  const hasCompleteNeighborTriangleIndex = completeNeighborIndex(storage, hasBoundaryFaceSubset);
  const neighbor =
    hasBoundaryFaceSubset && hasCompleteNeighborTriangleIndex
      ? buildNeighborCsr(storage)
      : { offsets: new Uint32Array(0), ids: new Uint32Array(0) };
  return {
    nodeTriangleFaceOffsets: node.offsets,
    nodeTriangleFaceIds: node.ids,
    neighborTriangleFaceOffsets: neighbor.offsets,
    neighborTriangleFaceIds: neighbor.ids,
    hasBoundaryFaceSubset,
    hasCompleteNeighborTriangleIndex,
  };
}

function buildNodeCsr(storage: PackedSemanticStorage): {
  readonly offsets: Uint32Array;
  readonly ids: Uint32Array;
} {
  if (storage.faceOwnerElementOrdinals.length === 0) {
    return { offsets: new Uint32Array(0), ids: new Uint32Array(0) };
  }
  const offsets = new Uint32Array(storage.nodeCount + 1);
  for (const nodeId of storage.faceNodeIds) {
    if (nodeId + 1 < offsets.length) {
      offsets[nodeId + 1] = (offsets[nodeId + 1] ?? 0) + 1;
    }
  }
  prefix(offsets);
  const ids = new Uint32Array(offsets[storage.nodeCount] ?? 0);
  const cursors = offsets.slice(0, storage.nodeCount);
  for (let face = 0; face < storage.faceOwnerElementOrdinals.length; face += 1) {
    const start = storage.faceNodeOffsets[face] ?? 0;
    const end = storage.faceNodeOffsets[face + 1] ?? start;
    for (let index = start; index < end; index += 1) {
      const nodeId = storage.faceNodeIds[index] ?? 0;
      const cursor = cursors[nodeId] ?? 0;
      ids[cursor] = face;
      cursors[nodeId] = cursor + 1;
    }
  }
  return { offsets, ids };
}

function packedBoundarySubset(storage: PackedSemanticStorage): boolean {
  const subset = storage.faceSubsetOrdinals;
  return (
    subset !== undefined &&
    subset.every((face) => {
      return (storage.faceNeighborElementOrdinals[face] ?? 0) === 0;
    })
  );
}

function completeNeighborIndex(storage: PackedSemanticStorage, required: boolean): boolean {
  if (!required) return true;
  for (const neighbor of storage.faceNeighborElementOrdinals) {
    if (neighbor > storage.elementIds.length) return false;
  }
  return true;
}

function buildNeighborCsr(storage: PackedSemanticStorage): {
  readonly offsets: Uint32Array;
  readonly ids: Uint32Array;
} {
  const offsets = new Uint32Array(storage.elementIds.length + 1);
  for (const neighbor of storage.faceNeighborElementOrdinals) {
    if (neighbor !== 0) offsets[neighbor] = (offsets[neighbor] ?? 0) + 1;
  }
  prefix(offsets);
  const ids = new Uint32Array(offsets[offsets.length - 1] ?? 0);
  const cursors = offsets.slice(0, -1);
  for (let face = 0; face < storage.faceNeighborElementOrdinals.length; face += 1) {
    const neighbor = storage.faceNeighborElementOrdinals[face] ?? 0;
    if (neighbor === 0) continue;
    const cursor = cursors[neighbor - 1] ?? 0;
    ids[cursor] = face;
    cursors[neighbor - 1] = cursor + 1;
  }
  return { offsets, ids };
}

function prefix(offsets: Uint32Array): void {
  for (let index = 1; index < offsets.length; index += 1) {
    offsets[index] = (offsets[index] ?? 0) + (offsets[index - 1] ?? 0);
  }
}
