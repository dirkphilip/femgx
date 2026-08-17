import {
  createPart,
  type ElementTessellation,
  type FaceTessellation,
  type Part,
  type TriangleGeometry,
} from "../../src/geometry/part";
import { createScene, type Scene } from "../../src/scene/scene";
import { translation } from "../../src/math/mat4";
import { ElementShape } from "../../src/elements/shapes";
import { canonicalKey } from "../../src/elements/keys";
import {
  createTet4Edges,
  tet4ElementNodeIds,
  tet4FaceNodeIdsFromNodes,
  type DenseTet4Payload,
} from "./tet4-transfer";
import type { DenseSemanticAllocationCounts } from "./types";

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
export function reconstructBenchmarkScene(
  payload: BenchmarkTransferPayload,
  assemblyName = `dense-tet4-${payload.elementCount}`,
): {
  readonly scene: Scene;
  readonly finalRetainedTypedBytes: number;
  readonly semanticAllocationCounts: DenseSemanticAllocationCounts;
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
      name: assemblyName,
      placements: [{ kind: "part", partId: 1, transform: translation(0, 0, 0) }],
    })
    .withRoot(1)
    .build();
  return {
    scene,
    finalRetainedTypedBytes:
      (payload.positions.buffer === payload.nodePositions.buffer
        ? 0
        : payload.positions.byteLength) +
      payload.indices.byteLength +
      payload.nodePickIds.byteLength +
      payload.nodePositions.byteLength +
      16 * Float32Array.BYTES_PER_ELEMENT,
    semanticAllocationCounts: countDenseSemanticAllocations(part),
  };
}

function countDenseSemanticAllocations(part: Part): DenseSemanticAllocationCounts {
  const elements = part.elements ?? [];
  const triangleGeometry = part.geometries.find((geometry) => geometry.primitive === "triangles");
  const faces = triangleGeometry?.primitive === "triangles" ? (triangleGeometry.faces ?? []) : [];
  const edges = triangleGeometry?.primitive === "triangles" ? (triangleGeometry.edges ?? []) : [];
  const faceNodeReferences = faces.reduce((total, face) => total + face.nodeIds.length, 0);
  const edgeNodeReferences = edges.reduce((total, edge) => total + edge.nodeIds.length, 0);
  const edgeIncidentElementReferences = edges.reduce(
    (total, edge) => total + edge.incidentElementIds.length,
    0,
  );
  const edgeFaceReferences = edges.reduce((total, edge) => total + edge.faceRefs.length, 0);
  const bodyElementReferences = (part.bodies ?? []).reduce(
    (total, body) => total + body.elementIds.length,
    0,
  );
  const nodeCount = (part.nodePositions?.length ?? 0) / 3;
  const triangles = triangleGeometry?.primitive === "triangles" ? triangleGeometry : undefined;
  const neighborCsrBytes = denseTetNeighborCsrBytes(elements, triangles, faces);
  return {
    elementDescriptors: elements.length,
    primitiveRangeArrays: elements.reduce(
      (total, element) => total + (element.primitiveRanges.length > 0 ? 1 : 0),
      0,
    ),
    primitiveRangeDescriptors: elements.reduce(
      (total, element) => total + element.primitiveRanges.length,
      0,
    ),
    faceDescriptors: faces.length,
    faceNodeArrays: faces.length,
    faceNodeReferences,
    faceKeyReferences: faces.length,
    faceSubsetReferences:
      triangleGeometry?.primitive === "triangles"
        ? (triangleGeometry.faceSubset?.faceIds.length ?? 0)
        : 0,
    edgeDescriptors: edges.length,
    edgeNodeArrays: edges.length,
    edgeNodeReferences,
    edgeIncidentElementReferences,
    edgeFaceReferenceArrays: edges.length,
    edgeFaceReferences,
    bodyDescriptors: part.bodies?.length ?? 0,
    bodyElementReferences,
    semanticIndex: {
      elementEntries: elements.length,
      elementOrdinalEntries: elements.length,
      bodyEntries: part.bodies?.length ?? 0,
      bodyByElementEntries: bodyElementReferences,
      faceEntries: faces.length,
      edgeEntries: edges.length,
      nodeTriangleFaceOffsetsBytes:
        faces.length === 0 ? 0 : (nodeCount + 1) * Uint32Array.BYTES_PER_ELEMENT,
      nodeTriangleFaceIdsBytes: faceNodeReferences * Uint32Array.BYTES_PER_ELEMENT,
      neighborTriangleFaceOffsetsBytes: neighborCsrBytes.offsetsBytes,
      neighborTriangleFaceIdsBytes: neighborCsrBytes.idsBytes,
    },
  };
}

function denseTetNeighborCsrBytes(
  elements: readonly ElementTessellation[],
  triangles: TriangleGeometry | undefined,
  faces: readonly FaceTessellation[],
): { readonly offsetsBytes: number; readonly idsBytes: number } {
  const subset = triangles?.faceSubset;
  const exteriorSubset =
    subset !== undefined &&
    subset.faceIds.every(({ elementId, faceIndex }) => {
      const face = faces[(elementId - 1) * 4 + faceIndex];
      return (
        face?.elementId === elementId &&
        face.faceIndex === faceIndex &&
        face.neighborElementId === undefined
      );
    });
  const localNeighbors = faces.every(
    ({ neighborElementId }) =>
      neighborElementId === undefined ||
      (neighborElementId >= 1 && neighborElementId <= elements.length),
  );
  if (!exteriorSubset || !localNeighbors) return { offsetsBytes: 0, idsBytes: 0 };
  const neighborFaceCount = faces.reduce(
    (count, face) => count + (face.neighborElementId === undefined ? 0 : 1),
    0,
  );
  return {
    offsetsBytes: (elements.length + 1) * Uint32Array.BYTES_PER_ELEMENT,
    idsBytes: neighborFaceCount * Uint32Array.BYTES_PER_ELEMENT,
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
    shape: ElementShape.Tet4,
    bodyId: 1,
  }));
}

function createFaces(payload: DenseTet4Payload) {
  const faces = new Array<ReturnType<typeof createFace>>(payload.elementCount * 4);
  for (let elementIndex = 0; elementIndex < payload.elementCount; elementIndex += 1) {
    const elementNodes = tet4ElementNodeIds(elementIndex, payload.gridSize);
    for (let faceIndex = 0; faceIndex < 4; faceIndex += 1) {
      const faceNumber = elementIndex * 4 + faceIndex;
      const nodeIds = tet4FaceNodeIdsFromNodes(elementNodes, faceIndex);
      faces[faceNumber] = createFace(payload, elementIndex, faceIndex, faceNumber, nodeIds);
    }
  }
  return faces;
}

function createFace(
  payload: DenseTet4Payload,
  elementIndex: number,
  faceIndex: number,
  faceNumber: number,
  nodeIds: readonly [number, number, number],
) {
  const neighborElementId = payload.faceNeighborIds[faceNumber] ?? 0;
  return {
    elementId: elementIndex + 1,
    faceIndex,
    primitiveStart: faceNumber,
    primitiveCount: 1,
    key: canonicalKey(nodeIds),
    nodeIds,
    ...(neighborElementId === 0 ? {} : { neighborElementId }),
    bodyId: 1,
  };
}
