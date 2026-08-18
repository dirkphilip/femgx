import { createPackedTet4Part } from "./packed-tet4";
import type { Part } from "../../src/geometry/part";
import { packedSemanticStorage } from "../../src/geometry/packed/packed-semantic";
import { createScene, type Scene } from "../../src/scene/scene";
import { translation } from "../../src/math/mat4";
import type { DenseTet4Payload } from "./tet4-transfer";
import type { DenseSemanticAllocationCounts } from "./types";

export type BenchmarkTransferPayload = DenseTet4Payload;

/** Phase timings and memory accounting returned with a worker result. */
export interface BenchmarkTransferMetrics {
  readonly generationMs: number;
  readonly topologyMs: number;
  readonly tessellationMs: number;
  readonly transferPreparationMs: number;
  readonly transferredBytes: number;
}

/** A worker result with its request identity and transfer accounting. */
export interface BenchmarkWorkerResult {
  readonly type: "result";
  readonly requestId: number;
  readonly payload: BenchmarkTransferPayload;
  readonly metrics: BenchmarkTransferMetrics;
}

/** Reconstructs the canonical immutable scene from one transferred FE payload. */
export function reconstructBenchmarkScene(
  payload: BenchmarkTransferPayload,
  assemblyName = `dense-tet4-${payload.elementCount}`,
): {
  readonly scene: Scene;
  readonly finalRetainedTypedBytes: number;
  readonly semanticAllocationCounts: DenseSemanticAllocationCounts;
} {
  const part = createPackedTet4Part(1, payload);
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: assemblyName,
      placements: [{ kind: "part", partId: 1, transform: translation(0, 0, 0) }],
    })
    .withRoot(1)
    .build();
  return {
    scene,
    finalRetainedTypedBytes: retainedTypedBytes(part),
    semanticAllocationCounts: countDenseSemanticAllocations(part),
  };
}

function retainedTypedBytes(part: Part): number {
  const buffers = new Set<ArrayBuffer>();
  const add = (array: ArrayBufferView | undefined): void => {
    if (array !== undefined && array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
  };
  for (const geometry of part.geometries) {
    add(geometry.positions);
    add(geometry.indices);
    add(geometry.nodePickIds);
  }
  add(part.nodePositions);
  const packed = packedSemanticStorage(part);
  if (packed !== undefined) {
    add(packed.elementIds);
    add(packed.elementPrimitiveStarts);
    add(packed.elementPrimitiveCounts);
    add(packed.elementFaceOffsets);
    add(packed.elementIdOrdinalsSorted);
    add(packed.elementBodyIds);
    add(packed.faceOwnerElementOrdinals);
    add(packed.faceIndices);
    add(packed.facePrimitiveStarts);
    add(packed.facePrimitiveCounts);
    add(packed.faceNeighborElementOrdinals);
    add(packed.faceNodeOffsets);
    add(packed.faceNodeIds);
    add(packed.edgeNodeOffsets);
    add(packed.edgeNodeIds);
    add(packed.edgeIncidentOffsets);
    add(packed.edgeIncidentElementOrdinals);
    add(packed.edgeFaceOffsets);
    add(packed.edgeFaceOwnerElementOrdinals);
    add(packed.edgeFaceIndices);
    add(packed.faceSubsetOrdinals);
  }
  return (
    [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0) +
    16 * Float32Array.BYTES_PER_ELEMENT
  );
}

function countDenseSemanticAllocations(part: Part): DenseSemanticAllocationCounts {
  const packed = packedSemanticStorage(part);
  if (packed !== undefined) return countPackedSemanticAllocations(packed);
  return countEmptySemanticAllocations();
}

function countPackedSemanticAllocations(
  packed: NonNullable<ReturnType<typeof packedSemanticStorage>>,
): DenseSemanticAllocationCounts {
  const hasFaces = packed.faceOwnerElementOrdinals.length > 0;
  let neighborFaceCount = 0;
  for (const neighbor of packed.faceNeighborElementOrdinals) {
    if (neighbor !== 0) neighborFaceCount += 1;
  }
  return {
    elementDescriptors: 0,
    primitiveRangeArrays: 0,
    primitiveRangeDescriptors: 0,
    faceDescriptors: 0,
    faceNodeArrays: 0,
    faceNodeReferences: packed.faceNodeIds.length,
    faceKeyReferences: 0,
    faceSubsetReferences: packed.faceSubsetOrdinals?.length ?? 0,
    edgeDescriptors: 0,
    edgeNodeArrays: 0,
    edgeNodeReferences: packed.edgeNodeIds?.length ?? 0,
    edgeIncidentElementReferences: packed.edgeIncidentElementOrdinals?.length ?? 0,
    edgeFaceReferenceArrays: 0,
    edgeFaceReferences: packed.edgeFaceOwnerElementOrdinals?.length ?? 0,
    bodyDescriptors: packed.bodies?.length ?? 0,
    bodyElementReferences: 0,
    semanticIndex: {
      elementEntries: 0,
      elementOrdinalEntries: 0,
      bodyEntries: packed.bodies?.length ?? 0,
      bodyByElementEntries: 0,
      faceEntries: 0,
      edgeEntries: 0,
      nodeTriangleFaceOffsetsBytes:
        (hasFaces ? packed.nodeCount + 1 : 0) * Uint32Array.BYTES_PER_ELEMENT,
      nodeTriangleFaceIdsBytes: packed.faceNodeIds.length * Uint32Array.BYTES_PER_ELEMENT,
      neighborTriangleFaceOffsetsBytes:
        (packed.elementIds.length + 1) * Uint32Array.BYTES_PER_ELEMENT,
      neighborTriangleFaceIdsBytes: neighborFaceCount * Uint32Array.BYTES_PER_ELEMENT,
    },
  };
}

function countEmptySemanticAllocations(): DenseSemanticAllocationCounts {
  return {
    elementDescriptors: 0,
    primitiveRangeArrays: 0,
    primitiveRangeDescriptors: 0,
    faceDescriptors: 0,
    faceNodeArrays: 0,
    faceNodeReferences: 0,
    faceKeyReferences: 0,
    faceSubsetReferences: 0,
    edgeDescriptors: 0,
    edgeNodeArrays: 0,
    edgeNodeReferences: 0,
    edgeIncidentElementReferences: 0,
    edgeFaceReferenceArrays: 0,
    edgeFaceReferences: 0,
    bodyDescriptors: 0,
    bodyElementReferences: 0,
    semanticIndex: {
      elementEntries: 0,
      elementOrdinalEntries: 0,
      bodyEntries: 0,
      bodyByElementEntries: 0,
      faceEntries: 0,
      edgeEntries: 0,
      nodeTriangleFaceOffsetsBytes: 0,
      nodeTriangleFaceIdsBytes: 0,
      neighborTriangleFaceOffsetsBytes: 0,
      neighborTriangleFaceIdsBytes: 0,
    },
  };
}

/** Collects every typed-array buffer owned by the worker payload exactly once. */
export function transferBuffers(payload: BenchmarkTransferPayload): ArrayBuffer[] {
  const arrays = [
    payload.nodePositions,
    payload.positions,
    payload.indices,
    payload.nodePickIds,
    payload.faceNeighborIds,
    payload.boundaryFaceIndices,
  ];
  const buffers: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  for (const array of arrays) {
    if (!(array.buffer instanceof ArrayBuffer) || seen.has(array.buffer)) continue;
    seen.add(array.buffer);
    buffers.push(array.buffer);
  }
  return buffers;
}

/** Returns the bytes in one typed-array collection. */
export function transferredByteLength(payload: BenchmarkTransferPayload): number {
  return transferBuffers(payload).reduce((total, buffer) => total + buffer.byteLength, 0);
}
