import { ElementShape } from "../../src/elements/shapes";
import type { GeometryBody, Part } from "../../src/geometry/part";
import { createPackedPart } from "../../src/geometry/packed/create-packed-part";
import {
  lazyPackedArray,
  type PackedSemanticStorage,
} from "../../src/geometry/packed/packed-semantic";
import type { DenseTet4Payload } from "./tet4-transfer";

const TET_FACE_CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 1, 3],
  [1, 2, 3],
  [2, 0, 3],
  [0, 2, 1],
];
const TET_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 0],
  [0, 3],
  [1, 3],
  [2, 3],
];

/** Builds a packed semantic Part from the transferred structured Tet4 arrays. */
export function createPackedTet4Part(
  partId: number,
  payload: DenseTet4Payload,
  name = "tet4 structured body",
): Part {
  const bodyElementIds = lazyPackedArray(payload.elementCount, (ordinal) => ordinal + 1);
  const body: GeometryBody = { id: 1, name, elementIds: bodyElementIds };
  const semantic = createPackedTet4Semantic(payload, [body]);
  return createPackedPart(partId, {
    geometries: [
      {
        primitive: "triangles",
        positions: payload.positions,
        indices: payload.indices,
        nodePickIds: payload.nodePickIds,
      },
    ],
    semantic,
    nodePositions: payload.nodePositions,
    bodies: [body],
  });
}

function createPackedTet4Semantic(
  payload: DenseTet4Payload,
  bodies: readonly GeometryBody[],
): PackedSemanticStorage {
  const { elementCount, faceCount } = payloadCounts(payload);
  const elementIds = Uint32Array.from({ length: elementCount }, (_, ordinal) => ordinal + 1);
  const elementPrimitiveStarts = Uint32Array.from(
    { length: elementCount },
    (_, ordinal) => ordinal * TET_FACE_CORNERS.length,
  );
  const elementPrimitiveCounts = new Uint32Array(elementCount);
  elementPrimitiveCounts.fill(TET_FACE_CORNERS.length);
  const elementFaceOffsets = Uint32Array.from(
    { length: elementCount + 1 },
    (_, ordinal) => ordinal * TET_FACE_CORNERS.length,
  );
  const elementBodyIds = new Uint32Array(elementCount);
  elementBodyIds.fill(1);
  const faceOwnerElementOrdinals = Uint32Array.from({ length: faceCount }, (_, faceOrdinal) =>
    Math.floor(faceOrdinal / TET_FACE_CORNERS.length),
  );
  const faceIndices = Uint32Array.from(
    { length: faceCount },
    (_, faceOrdinal) => faceOrdinal % TET_FACE_CORNERS.length,
  );
  const facePrimitiveStarts = Uint32Array.from({ length: faceCount }, (_, ordinal) => ordinal);
  const facePrimitiveCounts = new Uint32Array(faceCount);
  facePrimitiveCounts.fill(1);
  const faceNodeOffsets = Uint32Array.from({ length: faceCount + 1 }, (_, ordinal) => ordinal * 3);
  const faceNodeIds = createFaceNodeIds(payload, faceCount);
  const edges = createPackedEdges(payload, faceNodeIds, faceOwnerElementOrdinals);
  return {
    primitive: "triangles",
    elementIds,
    elementPrimitiveStarts,
    elementPrimitiveCounts,
    elementFaceOffsets,
    elementIdsOneBasedContiguous: true,
    elementShape: ElementShape.Tet4,
    elementBodyIds,
    faceOwnerElementOrdinals,
    faceIndices,
    facePrimitiveStarts,
    facePrimitiveCounts,
    faceNeighborElementOrdinals: payload.faceNeighborIds,
    faceNodeOffsets,
    faceNodeIds,
    edgeNodeOffsets: edges.nodeOffsets,
    edgeNodeIds: edges.nodeIds,
    edgeIncidentOffsets: edges.incidentOffsets,
    edgeIncidentElementOrdinals: edges.incidentElementOrdinals,
    edgeFaceOffsets: edges.faceOffsets,
    edgeFaceOwnerElementOrdinals: edges.faceOwnerElementOrdinals,
    edgeFaceIndices: edges.faceIndices,
    faceSubsetOrdinals: payload.boundaryFaceIndices,
    bodies,
    nodeCount: payload.nodePositions.length / 3,
  };
}

function payloadCounts(payload: DenseTet4Payload): {
  readonly elementCount: number;
  readonly faceCount: number;
} {
  return { elementCount: payload.elementCount, faceCount: payload.elementCount * 4 };
}

function createFaceNodeIds(payload: DenseTet4Payload, faceCount: number): Uint32Array {
  const nodes = new Uint32Array(faceCount * 3);
  for (let elementOrdinal = 0; elementOrdinal < payload.elementCount; elementOrdinal += 1) {
    const elementNodes = tetNodes(payload, elementOrdinal);
    for (let faceIndex = 0; faceIndex < TET_FACE_CORNERS.length; faceIndex += 1) {
      const corners = TET_FACE_CORNERS[faceIndex];
      if (corners === undefined) throw new Error("Tet4 face topology is incomplete");
      const target = (elementOrdinal * 4 + faceIndex) * 3;
      nodes[target] = elementNodes[corners[0]] ?? 0;
      nodes[target + 1] = elementNodes[corners[1]] ?? 0;
      nodes[target + 2] = elementNodes[corners[2]] ?? 0;
    }
  }
  return nodes;
}

interface PackedEdges {
  readonly nodeOffsets: Uint32Array;
  readonly nodeIds: Uint32Array;
  readonly incidentOffsets: Uint32Array;
  readonly incidentElementOrdinals: Uint32Array;
  readonly faceOffsets: Uint32Array;
  readonly faceOwnerElementOrdinals: Uint32Array;
  readonly faceIndices: Uint32Array;
}

function createPackedEdges(
  payload: DenseTet4Payload,
  faceNodeIds: Uint32Array,
  faceOwners: Uint32Array,
): PackedEdges {
  const elementEdgeOrdinals = new Uint32Array(payload.elementCount * TET_EDGES.length);
  const edgeKeyToOrdinal = new Map<number, number>();
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const nodeCount = payload.nodePositions.length / 3;
  for (let elementOrdinal = 0; elementOrdinal < payload.elementCount; elementOrdinal += 1) {
    const nodes = tetNodes(payload, elementOrdinal);
    for (let edgeIndex = 0; edgeIndex < TET_EDGES.length; edgeIndex += 1) {
      const pair = TET_EDGES[edgeIndex];
      if (pair === undefined) throw new Error("Tet4 edge topology is incomplete");
      const first = nodes[pair[0]] ?? 0;
      const second = nodes[pair[1]] ?? 0;
      const a = Math.min(first, second);
      const b = Math.max(first, second);
      const key = a * nodeCount + b;
      let ordinal = edgeKeyToOrdinal.get(key);
      if (ordinal === undefined) {
        ordinal = edgeA.length;
        edgeKeyToOrdinal.set(key, ordinal);
        edgeA.push(a);
        edgeB.push(b);
      }
      elementEdgeOrdinals[elementOrdinal * TET_EDGES.length + edgeIndex] = ordinal;
    }
  }
  const edgeCount = edgeA.length;
  const sortedOrdinals = edgeA
    .map((_first, ordinal) => ordinal)
    .sort((left, right) => {
      const first = (edgeA[left] ?? 0) - (edgeA[right] ?? 0);
      return first === 0 ? (edgeB[left] ?? 0) - (edgeB[right] ?? 0) : first;
    });
  const oldToNew = new Uint32Array(edgeCount);
  const sortedA: number[] = [];
  const sortedB: number[] = [];
  for (let ordinal = 0; ordinal < sortedOrdinals.length; ordinal += 1) {
    const oldOrdinal = sortedOrdinals[ordinal] ?? 0;
    oldToNew[oldOrdinal] = ordinal;
    sortedA.push(edgeA[oldOrdinal] ?? 0);
    sortedB.push(edgeB[oldOrdinal] ?? 0);
  }
  edgeA.length = 0;
  edgeB.length = 0;
  for (let ordinal = 0; ordinal < edgeCount; ordinal += 1) {
    edgeA.push(sortedA[ordinal] ?? 0);
    edgeB.push(sortedB[ordinal] ?? 0);
  }
  edgeKeyToOrdinal.clear();
  for (let ordinal = 0; ordinal < edgeCount; ordinal += 1) {
    edgeKeyToOrdinal.set((edgeA[ordinal] ?? 0) * nodeCount + (edgeB[ordinal] ?? 0), ordinal);
  }
  for (let reference = 0; reference < elementEdgeOrdinals.length; reference += 1) {
    elementEdgeOrdinals[reference] = oldToNew[elementEdgeOrdinals[reference] ?? 0] ?? 0;
  }
  const faceEdgeOrdinals = new Uint32Array(faceOwners.length * 3);
  const incidentCounts = new Uint32Array(edgeCount);
  const faceCounts = new Uint32Array(edgeCount);
  for (let elementOrdinal = 0; elementOrdinal < payload.elementCount; elementOrdinal += 1) {
    for (let edgeIndex = 0; edgeIndex < TET_EDGES.length; edgeIndex += 1) {
      const edgeOrdinal = elementEdgeOrdinals[elementOrdinal * 6 + edgeIndex] ?? 0;
      incidentCounts[edgeOrdinal] = (incidentCounts[edgeOrdinal] ?? 0) + 1;
    }
  }
  for (let faceOrdinal = 0; faceOrdinal < faceOwners.length; faceOrdinal += 1) {
    const start = faceOrdinal * 3;
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const first = faceNodeIds[start + edgeIndex] ?? 0;
      const second = faceNodeIds[start + ((edgeIndex + 1) % 3)] ?? 0;
      const key = Math.min(first, second) * nodeCount + Math.max(first, second);
      const edgeOrdinal = edgeKeyToOrdinal.get(key);
      if (edgeOrdinal === undefined) throw new Error("Tet4 face edge is missing");
      faceEdgeOrdinals[start + edgeIndex] = edgeOrdinal;
      faceCounts[edgeOrdinal] = (faceCounts[edgeOrdinal] ?? 0) + 1;
    }
  }
  const incidentOffsets = prefixOffsets(incidentCounts);
  const faceOffsets = prefixOffsets(faceCounts);
  const incidentElementOrdinals = new Uint32Array(incidentOffsets[edgeCount] ?? 0);
  const faceOwnerElementOrdinals = new Uint32Array(faceOffsets[edgeCount] ?? 0);
  const faceIndices = new Uint32Array(faceOffsets[edgeCount] ?? 0);
  const incidentCursors = incidentOffsets.slice(0, edgeCount);
  const faceCursors = faceOffsets.slice(0, edgeCount);
  for (let elementOrdinal = 0; elementOrdinal < payload.elementCount; elementOrdinal += 1) {
    for (let edgeIndex = 0; edgeIndex < TET_EDGES.length; edgeIndex += 1) {
      const edgeOrdinal = elementEdgeOrdinals[elementOrdinal * 6 + edgeIndex] ?? 0;
      const cursor = incidentCursors[edgeOrdinal] ?? 0;
      incidentElementOrdinals[cursor] = elementOrdinal;
      incidentCursors[edgeOrdinal] = cursor + 1;
    }
  }
  for (let faceOrdinal = 0; faceOrdinal < faceOwners.length; faceOrdinal += 1) {
    const start = faceOrdinal * 3;
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const edgeOrdinal = faceEdgeOrdinals[start + edgeIndex] ?? 0;
      const cursor = faceCursors[edgeOrdinal] ?? 0;
      faceOwnerElementOrdinals[cursor] = faceOwners[faceOrdinal] ?? 0;
      faceIndices[cursor] = faceOrdinal % 4;
      faceCursors[edgeOrdinal] = cursor + 1;
    }
  }
  const nodeOffsets = Uint32Array.from({ length: edgeCount + 1 }, (_, ordinal) => ordinal * 2);
  const nodeIds = new Uint32Array(edgeCount * 2);
  for (let ordinal = 0; ordinal < edgeCount; ordinal += 1) {
    nodeIds[ordinal * 2] = edgeA[ordinal] ?? 0;
    nodeIds[ordinal * 2 + 1] = edgeB[ordinal] ?? 0;
  }
  return {
    nodeOffsets,
    nodeIds,
    incidentOffsets,
    incidentElementOrdinals,
    faceOffsets,
    faceOwnerElementOrdinals,
    faceIndices,
  };
}

function prefixOffsets(counts: Uint32Array): Uint32Array {
  const offsets = new Uint32Array(counts.length + 1);
  for (let index = 0; index < counts.length; index += 1) {
    offsets[index + 1] = (offsets[index] ?? 0) + (counts[index] ?? 0);
  }
  return offsets;
}

function tetNodes(
  payload: DenseTet4Payload,
  elementOrdinal: number,
): readonly [number, number, number, number] {
  const gridSize = payload.gridSize;
  const side = gridSize + 1;
  const layer = side * side;
  const cell = Math.floor(elementOrdinal / 6);
  const local = elementOrdinal % 6;
  const x = cell % gridSize;
  const y = Math.floor(cell / gridSize) % gridSize;
  const z = Math.floor(cell / (gridSize * gridSize));
  const base = z * layer + y * side + x;
  const n000 = base;
  const n100 = base + 1;
  const n010 = base + side;
  const n110 = n010 + 1;
  const n001 = base + layer;
  const n101 = n001 + 1;
  const n011 = n001 + side;
  const n111 = n011 + 1;
  switch (local) {
    case 0:
      return [n000, n100, n110, n111];
    case 1:
      return [n000, n110, n010, n111];
    case 2:
      return [n000, n010, n011, n111];
    case 3:
      return [n000, n011, n001, n111];
    case 4:
      return [n000, n001, n101, n111];
    default:
      return [n000, n101, n100, n111];
  }
}
