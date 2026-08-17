import { createPart, type ElementTessellation } from "../../src/geometry/part";
import { createScene, type Scene } from "../../src/scene/scene";
import { translation } from "../../src/math/mat4";
import { TET4_SHAPE } from "../../src/elements/shapes";
import { canonicalKey } from "../../src/elements/keys";
import { createTet4Edges, tet4FaceNodeIds, type DenseTet4Payload } from "./tet4-transfer";

export type BenchmarkTransferPayload = DenseTet4Payload;

/** Phase timings and memory accounting returned with a worker result. */
export interface BenchmarkTransferMetrics {
  readonly generationMs: number;
  readonly topologyMs: number;
  readonly tessellationMs: number;
  readonly transferPreparationMs: number;
  readonly transferredBytes: number;
  readonly finalRetainedTypedBytes: number;
}

/** A worker result with its request identity and transfer accounting. */
export interface BenchmarkWorkerResult {
  readonly type: "result";
  readonly requestId: number;
  readonly payload: BenchmarkTransferPayload;
  readonly metrics: BenchmarkTransferMetrics;
}

/** Reconstructs the canonical immutable scene from one transferred FE payload. */
export function reconstructBenchmarkScene(payload: BenchmarkTransferPayload): {
  readonly scene: Scene;
  readonly finalRetainedTypedBytes: number;
} {
  const elements = createElements(payload.elementCount);
  const faces = createFaces(payload);
  const edges = createTet4Edges(payload.gridSize, payload.elementCount);
  const boundaryFaces = Array.from(payload.boundaryFaceIndices, (faceNumber) => {
    return { elementId: Math.floor(faceNumber / 4) + 1, faceIndex: faceNumber % 4 };
  });
  const part = createPart(1, {
    geometries: [
      {
        primitive: "triangles",
        positions: payload.positions,
        indices: payload.indices,
        nodePickIds: payload.nodePickIds,
        edges,
        faces,
        faceSubset: { faceIds: boundaryFaces },
      },
    ],
    elements,
    nodePositions: payload.nodePositions,
    bodies: [{ id: 1, name: "tet4 structured body", elementIds: elements.map(({ id }) => id) }],
  });
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "fe-tet4-solid-132k",
      placements: [{ kind: "part", partId: 1, transform: translation(0, 0, 0) }],
    })
    .withRoot(1)
    .build();
  return {
    scene,
    finalRetainedTypedBytes:
      payload.positions.byteLength +
      payload.indices.byteLength +
      payload.nodePickIds.byteLength +
      payload.nodePositions.byteLength +
      16 * Float32Array.BYTES_PER_ELEMENT,
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

function createElements(count: number): ElementTessellation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    primitiveRanges: [
      { primitive: "triangles" as const, primitiveStart: index * 4, primitiveCount: 4 },
    ],
    shape: TET4_SHAPE,
    bodyId: 1,
  }));
}

function createFaces(payload: DenseTet4Payload) {
  return Array.from({ length: payload.elementCount * 4 }, (_, faceNumber) => {
    const elementId = Math.floor(faceNumber / 4) + 1;
    const faceIndex = faceNumber % 4;
    const nodeIds = tet4FaceNodeIds(Math.floor(faceNumber / 4), faceIndex, payload.gridSize);
    const neighborElementId = payload.faceNeighborIds[faceNumber] ?? 0;
    return {
      elementId,
      faceIndex,
      primitiveStart: faceNumber,
      primitiveCount: 1,
      key: canonicalKey(nodeIds),
      nodeIds,
      ...(neighborElementId === 0 ? {} : { neighborElementId }),
      bodyId: 1,
    };
  });
}
