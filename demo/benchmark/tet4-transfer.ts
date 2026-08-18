import { canonicalKey } from "../../src/elements/keys";
import { at } from "../../src/elements/indices";
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
const MAX_DENSE_TET4_GRID_SIZE = 200;

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
  if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > MAX_DENSE_TET4_GRID_SIZE) {
    throw new Error(
      `structured FE grid size must be an integer in [1,${MAX_DENSE_TET4_GRID_SIZE}]`,
    );
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
  const nodes = tet4ElementNodeIds(elementIndex, gridSize, side, side * side);
  return tet4FaceNodeIdsFromNodes(nodes, faceIndex);
}

/** Returns one structured Tet4 element's authored node ids. */
export function tet4ElementNodeIds(
  elementIndex: number,
  gridSize: number,
  side = gridSize + 1,
  layer = side * side,
): readonly [number, number, number, number] {
  return tetNodes(elementIndex, gridSize, side, layer);
}

/** Returns one face loop from an already-resolved Tet4 connectivity tuple. */
export function tet4FaceNodeIdsFromNodes(
  nodes: readonly [number, number, number, number],
  faceIndex: number,
): readonly [number, number, number] {
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
  const side = gridSize + 1;
  const nodeCount = side ** 3;
  const edges = new Map<number, EdgeAccumulator>();
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const elementId = elementIndex + 1;
    const nodes = tetNodes(elementIndex, gridSize, side, side * side);
    for (const [firstCorner, secondCorner] of TET_EDGES) {
      const first = at(nodes, firstCorner);
      const second = at(nodes, secondCorner);
      const nodeIds: readonly [number, number] = [Math.min(first, second), Math.max(first, second)];
      const key = nodeIds[0] * nodeCount + nodeIds[1];
      const edge = edges.get(key) ?? {
        nodeIds,
        incidentElementIds: [],
        faceRefs: [],
      };
      if (edge.incidentElementIds.at(-1) !== elementId) edge.incidentElementIds.push(elementId);
      edges.set(key, edge);
    }
    for (let faceIndex = 0; faceIndex < TET_FACE_CORNERS.length; faceIndex += 1) {
      const corners = TET_FACE_CORNERS[faceIndex];
      if (corners === undefined) throw new Error("Tet4 face topology is incomplete");
      const faceNodes = [
        at(nodes, corners[0]),
        at(nodes, corners[1]),
        at(nodes, corners[2]),
      ] as const;
      for (let edgeIndex = 0; edgeIndex < faceNodes.length; edgeIndex += 1) {
        const first = faceNodes[edgeIndex] ?? 0;
        const second = faceNodes[(edgeIndex + 1) % faceNodes.length] ?? 0;
        const key = Math.min(first, second) * nodeCount + Math.max(first, second);
        const edge = edges.get(key);
        if (edge === undefined) throw new Error("Tet4 face edge is missing");
        edge.faceRefs.push({ elementId, faceIndex });
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
  const side = gridSize + 1;
  const layer = side * side;
  const nodeCount = layer * side;
  const firstFaceByKey = new Map<number, number>();
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const elementId = elementIndex + 1;
    const nodes = tetNodes(elementIndex, gridSize, side, layer);
    for (let faceIndex = 0; faceIndex < TET_FACE_CORNERS.length; faceIndex += 1) {
      const faceNumber = elementIndex * TET_FACE_CORNERS.length + faceIndex;
      const corners = TET_FACE_CORNERS[faceIndex];
      if (corners === undefined) throw new Error("Tet4 face topology is incomplete");
      const key = packedFaceKey(nodes, corners, nodeCount);
      const previous = firstFaceByKey.get(key);
      if (previous === undefined) {
        firstFaceByKey.set(key, faceNumber);
      } else {
        if (faceNeighborIds[previous] !== 0) {
          throw new Error("Structured Tet4 topology contains a non-manifold face");
        }
        faceNeighborIds[previous] = elementId;
        faceNeighborIds[faceNumber] = Math.floor(previous / TET_FACE_CORNERS.length) + 1;
      }
    }
  }
  const boundaryFaceIndices = new Uint32Array(12 * gridSize * gridSize);
  let boundaryIndex = 0;
  for (const faceNumber of firstFaceByKey.values()) {
    if (faceNeighborIds[faceNumber] !== 0) continue;
    boundaryFaceIndices[boundaryIndex] = faceNumber;
    boundaryIndex += 1;
  }
  if (boundaryIndex !== boundaryFaceIndices.length) {
    throw new Error(`Tet4 boundary face count ${boundaryIndex} is inconsistent with the grid`);
  }
  return { faceNeighborIds, boundaryFaceIndices };
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
  const nodePickIds = new Uint32Array(nodes.length / 3);
  for (let node = 0; node < nodePickIds.length; node += 1) nodePickIds[node] = node + 1;
  const indices = new Uint32Array(elementCount * TET_FACE_CORNERS.length * 3);
  let indexOffset = 0;
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const elementNodes = tetNodes(elementIndex, gridSize, side, layer);
    let elementX = 0;
    let elementY = 0;
    let elementZ = 0;
    for (const node of elementNodes) {
      const offset = node * 3;
      elementX += nodes[offset] ?? 0;
      elementY += nodes[offset + 1] ?? 0;
      elementZ += nodes[offset + 2] ?? 0;
    }
    elementX /= 4;
    elementY /= 4;
    elementZ /= 4;
    const elementCenter = [elementX, elementY, elementZ] as const;
    for (const corners of TET_FACE_CORNERS) {
      const first = at(elementNodes, corners[0]);
      const second = at(elementNodes, corners[1]);
      const third = at(elementNodes, corners[2]);
      const reverse = faceIsReversed(nodes, first, second, third, elementCenter);
      indices[indexOffset] = first;
      indices[indexOffset + 1] = reverse ? third : second;
      indices[indexOffset + 2] = reverse ? second : third;
      indexOffset += 3;
    }
  }
  return { positions: nodes, indices, nodePickIds };
}

function faceIsReversed(
  nodes: Float32Array,
  first: number,
  second: number,
  third: number,
  elementCenter: readonly [number, number, number],
): boolean {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  const thirdOffset = third * 3;
  const ax = nodes[firstOffset] ?? 0;
  const ay = nodes[firstOffset + 1] ?? 0;
  const az = nodes[firstOffset + 2] ?? 0;
  const bx = nodes[secondOffset] ?? 0;
  const by = nodes[secondOffset + 1] ?? 0;
  const bz = nodes[secondOffset + 2] ?? 0;
  const cx = nodes[thirdOffset] ?? 0;
  const cy = nodes[thirdOffset + 1] ?? 0;
  const cz = nodes[thirdOffset + 2] ?? 0;
  const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const outwardX = (ax + bx + cx) / 3 - elementCenter[0];
  const outwardY = (ay + by + cy) / 3 - elementCenter[1];
  const outwardZ = (az + bz + cz) / 3 - elementCenter[2];
  return nx * outwardX + ny * outwardY + nz * outwardZ < 0;
}

function packedFaceKey(
  nodes: readonly [number, number, number, number],
  corners: readonly [number, number, number],
  nodeCount: number,
): number {
  let first = at(nodes, corners[0]);
  let second = at(nodes, corners[1]);
  let third = at(nodes, corners[2]);
  if (first > second) {
    const swap = first;
    first = second;
    second = swap;
  }
  if (second > third) {
    const swap = second;
    second = third;
    third = swap;
  }
  if (first > second) {
    const swap = first;
    first = second;
    second = swap;
  }
  return (first * nodeCount + second) * nodeCount + third;
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

function compareNodeIds(left: readonly number[], right: readonly number[]): number {
  return (left[0] ?? 0) - (right[0] ?? 0) || (left[1] ?? 0) - (right[1] ?? 0);
}
