import { at } from "../../src/elements/indices";
import { sortFixedCanonicalRows } from "../../src/elements/canonical-row-order";

const TET_FACE_CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 1, 3],
  [1, 2, 3],
  [2, 0, 3],
  [0, 2, 1],
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
  const faceNodes = new Uint32Array(faceCount * 3);
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const nodes = tetNodes(elementIndex, gridSize, side, layer);
    for (let faceIndex = 0; faceIndex < TET_FACE_CORNERS.length; faceIndex += 1) {
      const faceNumber = elementIndex * TET_FACE_CORNERS.length + faceIndex;
      const corners = TET_FACE_CORNERS[faceIndex];
      if (corners === undefined) throw new Error("Tet4 face topology is incomplete");
      writeCanonicalFaceNodes(faceNodes, faceNumber * 3, nodes, corners);
    }
  }
  const order = sortFixedCanonicalRows(faceNodes, 3);
  const expectedBoundaryCount = 12 * gridSize * gridSize;
  const boundaryFaceIndices = new Uint32Array(expectedBoundaryCount);
  let boundaryIndex = 0;
  for (let start = 0; start < order.length;) {
    const first = order[start] ?? 0;
    let end = start + 1;
    while (end < order.length && equalFixedRows(faceNodes, first, order[end] ?? 0, 3)) end += 1;
    if (end - start === 1) {
      boundaryFaceIndices[boundaryIndex] = first;
      boundaryIndex += 1;
    } else if (end - start === 2) {
      const second = order[start + 1] ?? 0;
      faceNeighborIds[first] = Math.floor(second / TET_FACE_CORNERS.length) + 1;
      faceNeighborIds[second] = Math.floor(first / TET_FACE_CORNERS.length) + 1;
    } else throw new Error("Structured Tet4 topology contains a non-manifold face");
    start = end;
  }
  if (boundaryIndex !== expectedBoundaryCount) {
    throw new Error(`Tet4 boundary face count ${boundaryIndex} is inconsistent with the grid`);
  }
  boundaryFaceIndices.sort();
  return { faceNeighborIds, boundaryFaceIndices };
}

function writeCanonicalFaceNodes(
  target: Uint32Array,
  offset: number,
  nodes: readonly [number, number, number, number],
  corners: readonly [number, number, number],
): void {
  target[offset] = at(nodes, corners[0]);
  target[offset + 1] = at(nodes, corners[1]);
  target[offset + 2] = at(nodes, corners[2]);
  if ((target[offset] ?? 0) > (target[offset + 1] ?? 0)) swap(target, offset, offset + 1);
  if ((target[offset + 1] ?? 0) > (target[offset + 2] ?? 0)) swap(target, offset + 1, offset + 2);
  if ((target[offset] ?? 0) > (target[offset + 1] ?? 0)) swap(target, offset, offset + 1);
}

function swap(values: Uint32Array, left: number, right: number): void {
  const value = values[left] ?? 0;
  values[left] = values[right] ?? 0;
  values[right] = value;
}

function equalFixedRows(nodes: Uint32Array, left: number, right: number, width: number): boolean {
  for (let column = 0; column < width; column += 1) {
    if (nodes[left * width + column] !== nodes[right * width + column]) return false;
  }
  return true;
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
