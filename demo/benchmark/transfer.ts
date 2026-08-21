import { createPackedTet4Part } from "./packed-tet4";
import type { Part } from "../../src/geometry/part";
import {
  partSemanticGraph,
  type PartSemanticGraph,
} from "../../src/geometry/semantic/part-semantic-graph";
import { createSceneBuilder, type Scene } from "../../src/scene/scene";
import { translationMatrix } from "../../src/math/mat4";
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
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: assemblyName,
      placements: [
        {
          kind: "part",
          placementId: "transfer",
          partId: 1,
          transform: translationMatrix(0, 0, 0),
        },
      ],
    })
    .setRootAssembly(1)
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
  const graph = partSemanticGraph(part);
  if (graph !== undefined) {
    for (const column of Object.values(graph)) {
      if (ArrayBuffer.isView(column)) add(column);
    }
  }
  return (
    [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0) +
    16 * Float32Array.BYTES_PER_ELEMENT
  );
}

function countDenseSemanticAllocations(part: Part): DenseSemanticAllocationCounts {
  const graph = partSemanticGraph(part);
  if (graph !== undefined) return countGraphSemanticAllocations(graph);
  return countEmptySemanticAllocations();
}

function countGraphSemanticAllocations(graph: PartSemanticGraph): DenseSemanticAllocationCounts {
  const hasFaces = graph.faceOwnerElementOrdinals.length > 0;
  let neighborFaceCount = 0;
  for (const neighbor of graph.faceNeighborElementOrdinals) {
    if (neighbor !== 0) neighborFaceCount += 1;
  }
  return {
    elementDescriptors: 0,
    primitiveRangeArrays: 0,
    primitiveRangeDescriptors: 0,
    faceDescriptors: 0,
    faceNodeArrays: 0,
    faceNodeReferences: graph.faceNodeIds.length,
    faceKeyReferences: 0,
    faceSubsetReferences: graph.faceSubsetOrdinals.length,
    edgeDescriptors: 0,
    edgeNodeArrays: 0,
    edgeNodeReferences: graph.edgeNodeIds.length,
    edgeIncidentElementReferences: graph.edgeIncidentElementOrdinals.length,
    edgeFaceReferenceArrays: 0,
    edgeFaceReferences: graph.edgeFaceOwnerElementOrdinals.length,
    bodyDescriptors: 0,
    bodyElementReferences: 0,
    semanticIndex: {
      elementEntries: 0,
      elementOrdinalEntries: 0,
      bodyEntries: 0,
      bodyByElementEntries: 0,
      faceEntries: 0,
      edgeEntries: 0,
      nodeTriangleFaceOffsetsBytes:
        (hasFaces ? graph.faceNodeIds.length + 1 : 0) * Uint32Array.BYTES_PER_ELEMENT,
      nodeTriangleFaceIdsBytes: graph.faceNodeIds.length * Uint32Array.BYTES_PER_ELEMENT,
      neighborTriangleFaceOffsetsBytes:
        (graph.elementIds.length + 1) * Uint32Array.BYTES_PER_ELEMENT,
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
