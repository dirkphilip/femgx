import { canonicalKey } from "../../src/elements/keys";
import type { FaceIdRef } from "../../src/elements/faces";
import type { GeometryEdge } from "../../src/geometry/part";

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

/** Compact ownership-transfer payload for the heavy structured Tet4 case. */
export interface DenseTet4Payload {
  readonly kind: "dense-tet4";
  readonly gridSize: number;
  readonly elementCount: number;
  readonly nodePositions: Float32Array;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
  readonly faceNeighborIds: Uint32Array;
  readonly boundaryFaceIndices: Uint32Array;
}

/** Timings for the dense worker-side topology construction. */
export interface DenseTet4BuildTimings {
  readonly generationMs: number;
  readonly topologyMs: number;
  readonly tessellationMs: number;
}

/** Builds Tet4 topology and tessellation without retaining per-face objects in the worker. */
export function buildDenseTet4Payload(
  gridSize: number,
  onPhase?: (phase: "topology" | "tessellation") => void,
): { readonly payload: DenseTet4Payload; readonly timings: DenseTet4BuildTimings } {
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error("structured FE grid size must be a positive integer");
  }
  const generationStart = performance.now();
  const side = gridSize + 1;
  const layer = side * side;
  const nodeCount = side * side * side;
  const elementCount = gridSize ** 3 * 6;
  const faceCount = elementCount * TET_FACE_CORNERS.length;
  const nodePositions = createNodePositions(gridSize, side, layer, nodeCount);
  const generationMs = performance.now() - generationStart;

  onPhase?.("topology");
  const topologyStart = performance.now();
  const topology = createTopology(gridSize, elementCount, faceCount);
  const topologyMs = performance.now() - topologyStart;

  onPhase?.("tessellation");
  const tessellationStart = performance.now();
  const geometry = createTessellation(gridSize, side, layer, elementCount, nodePositions);
  const tessellationMs = performance.now() - tessellationStart;

  return {
    payload: {
      kind: "dense-tet4",
      gridSize,
      elementCount,
      nodePositions,
      positions: geometry.positions,
      indices: geometry.indices,
      nodePickIds: geometry.nodePickIds,
      faceNeighborIds: topology.faceNeighborIds,
      boundaryFaceIndices: topology.boundaryFaceIndices,
    },
    timings: { generationMs, topologyMs, tessellationMs },
  };
}

/** Returns the canonical node loop for one structured Tet4 face. */
export function tet4FaceNodeIds(
  elementIndex: number,
  faceIndex: number,
  gridSize: number,
): readonly [number, number, number] {
  const side = gridSize + 1;
  const nodes = tetNodes(elementIndex, gridSize, side, side * side);
  const corners = TET_FACE_CORNERS[faceIndex];
  if (corners === undefined) throw new Error(`Tet4 face ${faceIndex} is missing`);
  const first = nodes[corners[0]];
  const second = nodes[corners[1]];
  const third = nodes[corners[2]];
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("Tet4 face topology is incomplete");
  }
  return [first, second, third];
}

/** Recreates authored edge metadata from the deterministic Tet4 specification. */
export function createTet4Edges(gridSize: number, elementCount: number): GeometryEdge[] {
  const edges = new Map<string, EdgeAccumulator>();
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const elementId = elementIndex + 1;
    const nodes = tetNodes(elementIndex, gridSize, gridSize + 1, (gridSize + 1) ** 2);
    for (const [firstCorner, secondCorner] of TET_EDGES) {
      const first = nodes[firstCorner];
      const second = nodes[secondCorner];
      if (first === undefined || second === undefined) throw new Error("Tet4 edge is incomplete");
      const nodeIds: readonly [number, number] = [Math.min(first, second), Math.max(first, second)];
      const edge = edges.get(canonicalKey(nodeIds)) ?? {
        nodeIds,
        incidentElementIds: [],
        faceRefs: [],
      };
      if (edge.incidentElementIds.at(-1) !== elementId) edge.incidentElementIds.push(elementId);
      edges.set(canonicalKey(nodeIds), edge);
    }
    for (let faceIndex = 0; faceIndex < TET_FACE_CORNERS.length; faceIndex += 1) {
      const faceNodes = tet4FaceNodeIds(elementIndex, faceIndex, gridSize);
      for (let edgeIndex = 0; edgeIndex < faceNodes.length; edgeIndex += 1) {
        const first = faceNodes[edgeIndex] ?? 0;
        const second = faceNodes[(edgeIndex + 1) % faceNodes.length] ?? 0;
        const key = canonicalKey([Math.min(first, second), Math.max(first, second)]);
        const edge = edges.get(key);
        if (edge === undefined) throw new Error("Tet4 face edge is missing");
        if (
          !edge.faceRefs.some((ref) => ref.elementId === elementId && ref.faceIndex === faceIndex)
        ) {
          edge.faceRefs.push({ elementId, faceIndex });
        }
      }
    }
  }
  return [...edges.values()]
    .sort((left, right) => compareNodeIds(left.nodeIds, right.nodeIds))
    .map((edge) => ({
      key: canonicalKey(edge.nodeIds),
      nodeIds: edge.nodeIds,
      incidentElementIds: edge.incidentElementIds,
      faceRefs: edge.faceRefs,
    }));
}

interface EdgeAccumulator {
  readonly nodeIds: readonly [number, number];
  readonly incidentElementIds: number[];
  readonly faceRefs: FaceIdRef[];
}

interface Topology {
  readonly faceNeighborIds: Uint32Array;
  readonly boundaryFaceIndices: Uint32Array;
}

function createNodePositions(
  gridSize: number,
  side: number,
  layer: number,
  nodeCount: number,
): Float32Array {
  const nodes = new Float32Array(nodeCount * 3);
  for (let z = 0; z <= gridSize; z += 1) {
    for (let y = 0; y <= gridSize; y += 1) {
      for (let x = 0; x <= gridSize; x += 1) {
        const offset = (z * layer + y * side + x) * 3;
        nodes[offset] = x;
        nodes[offset + 1] = y;
        nodes[offset + 2] = z;
      }
    }
  }
  return nodes;
}

function createTopology(gridSize: number, elementCount: number, faceCount: number): Topology {
  const faceNeighborIds = new Uint32Array(faceCount);
  const faceCounts = new Uint8Array(faceCount);
  const faceOwnerIds = new Uint32Array(faceCount);
  const firstFaceByKey = new Map<string, number>();
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const elementId = elementIndex + 1;
    for (let faceIndex = 0; faceIndex < TET_FACE_CORNERS.length; faceIndex += 1) {
      const faceNumber = elementIndex * TET_FACE_CORNERS.length + faceIndex;
      const key = canonicalKey(tet4FaceNodeIds(elementIndex, faceIndex, gridSize));
      faceOwnerIds[faceNumber] = elementId;
      const previous = firstFaceByKey.get(key);
      if (previous === undefined) {
        firstFaceByKey.set(key, faceNumber);
        faceCounts[faceNumber] = 1;
      } else {
        faceCounts[previous] = 2;
        faceNeighborIds[previous] = elementId;
        faceNeighborIds[faceNumber] = faceOwnerIds[previous] ?? 0;
      }
    }
  }
  const boundaryFaceIndices: number[] = [];
  for (const faceNumber of firstFaceByKey.values()) {
    if (faceCounts[faceNumber] === 1) boundaryFaceIndices.push(faceNumber);
  }
  return { faceNeighborIds, boundaryFaceIndices: new Uint32Array(boundaryFaceIndices) };
}

function createTessellation(
  gridSize: number,
  side: number,
  layer: number,
  elementCount: number,
  nodes: Float32Array,
): {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly nodePickIds: Uint32Array;
} {
  const positions = new Float32Array(nodes.length);
  const nodePickIds = new Uint32Array(nodes.length / 3);
  const indices = new Uint32Array(elementCount * TET_FACE_CORNERS.length * 3);
  const vertexByNode = new Map<number, number>();
  let vertexCount = 0;
  let indexOffset = 0;
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const elementNodes = tetNodes(elementIndex, gridSize, side, layer);
    const elementCenter = averagePosition(nodes, elementNodes);
    for (const corners of TET_FACE_CORNERS) {
      const first = elementNodes[corners[0]];
      const second = elementNodes[corners[1]];
      const third = elementNodes[corners[2]];
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error("Tet4 tessellation topology is incomplete");
      }
      const faceCenter = averagePosition(nodes, [first, second, third]);
      const normal = cross(
        subtract(position(nodes, second), position(nodes, first)),
        subtract(position(nodes, third), position(nodes, first)),
      );
      const outward = subtract(faceCenter, elementCenter);
      const ordered = dot(normal, outward) < 0 ? [first, third, second] : [first, second, third];
      for (const nodeId of ordered) {
        let vertex = vertexByNode.get(nodeId);
        if (vertex === undefined) {
          vertex = vertexCount;
          vertexCount += 1;
          vertexByNode.set(nodeId, vertex);
          positions.set(nodes.subarray(nodeId * 3, nodeId * 3 + 3), vertex * 3);
          nodePickIds[vertex] = nodeId + 1;
        }
        indices[indexOffset] = vertex;
        indexOffset += 1;
      }
    }
  }
  return {
    positions: positions.slice(0, vertexCount * 3),
    indices: indices.slice(0, indexOffset),
    nodePickIds: nodePickIds.slice(0, vertexCount),
  };
}

function tetNodes(
  elementIndex: number,
  gridSize: number,
  side: number,
  layer: number,
): readonly [number, number, number, number] {
  const cellIndex = Math.floor(elementIndex / 6);
  const local = elementIndex % 6;
  const x = cellIndex % gridSize;
  const y = Math.floor(cellIndex / gridSize) % gridSize;
  const z = Math.floor(cellIndex / (gridSize * gridSize));
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
    case 5:
      return [n000, n101, n100, n111];
    default:
      throw new Error("Tet4 element topology is incomplete");
  }
}

function position(nodes: Float32Array, nodeId: number): readonly [number, number, number] {
  const offset = nodeId * 3;
  return [nodes[offset] ?? 0, nodes[offset + 1] ?? 0, nodes[offset + 2] ?? 0];
}

function averagePosition(
  nodes: Float32Array,
  nodeIds: readonly number[],
): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const nodeId of nodeIds) {
    const point = position(nodes, nodeId);
    x += point[0];
    y += point[1];
    z += point[2];
  }
  return [x / nodeIds.length, y / nodeIds.length, z / nodeIds.length];
}

function compareNodeIds(left: readonly number[], right: readonly number[]): number {
  return (left[0] ?? 0) - (right[0] ?? 0) || (left[1] ?? 0) - (right[1] ?? 0);
}

function subtract(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
