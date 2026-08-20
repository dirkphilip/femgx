import type { ElementTessellation, Part } from "../geometry/part";
import {
  partSemanticGraph,
  type PartSemanticGraph,
} from "../geometry/semantic/part-semantic-graph";

/** Topology-derived data shared by all orientation fields on one part. */
export interface OrientationTopologyElement {
  readonly id: number;
  readonly bodyId: number | undefined;
  readonly nodeIds: readonly number[];
}

/** Deterministic element order and lookup for one immutable part. */
export interface OrientationPartTopology {
  readonly elements: readonly OrientationTopologyElement[];
  readonly byId: ReadonlyMap<number, OrientationTopologyElement>;
}

interface AnchorStats {
  readonly count: number;
  readonly sumX: number;
  readonly sumY: number;
  readonly sumZ: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

const topologyCache = new WeakMap<Part, OrientationPartTopology>();

/** Returns cached topology-derived node coverage for an immutable part. */
export function getOrientationTopology(part: Part): OrientationPartTopology {
  const cached = topologyCache.get(part);
  if (cached !== undefined) return cached;
  const graph = partSemanticGraph(part);
  const elements =
    graph === undefined || graph.faceNodeIds.length === 0
      ? topologyElements(part)
      : graphTopologyElements(graph);
  elements.sort((left, right) => left.id - right.id);
  const topology = { elements, byId: new Map(elements.map((element) => [element.id, element])) };
  topologyCache.set(part, topology);
  return topology;
}

function topologyElements(part: Part): OrientationTopologyElement[] {
  const elements: OrientationTopologyElement[] = [];
  for (const element of part.elements ?? []) elements.push(createTopologyElement(part, element));
  return elements;
}

function graphTopologyElements(graph: PartSemanticGraph): OrientationTopologyElement[] {
  return Array.from({ length: graph.elementIds.length }, (_, ordinal) => {
    const nodes = new Set<number>();
    for (let face = 0; face < graph.faceOwnerElementOrdinals.length; face += 1) {
      if (graph.faceOwnerElementOrdinals[face] !== ordinal) continue;
      const start = graph.faceNodeOffsets[face] ?? 0;
      const end = graph.faceNodeOffsets[face + 1] ?? start;
      for (let index = start; index < end; index += 1) {
        const nodeId = graph.faceNodeIds[index];
        if (nodeId !== undefined) nodes.add(nodeId);
      }
    }
    const bodyId = graph.elementBodyIds[ordinal];
    return {
      id: graph.elementIds[ordinal] ?? 0,
      nodeIds: [...nodes].sort((left, right) => left - right),
      bodyId: bodyId === undefined || bodyId === 0 ? undefined : bodyId,
    };
  });
}

/** Resolves one element's unique authored-node anchor and local reference size. */
export function resolveOrientationAnchor(
  part: Part,
  field: { readonly id: string },
  element: OrientationTopologyElement,
  nodePositions: Float32Array,
): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly referenceLength: number;
} {
  if (!part.geometries.some((geometry) => geometry.nodePickIds !== undefined)) {
    throw new Error(
      `Elemental orientation field ${field.id} cannot anchor part ${part.id} element ${element.id}: geometry has no nodePickIds`,
    );
  }
  if (element.nodeIds.length < 2) {
    throw new Error(
      `Elemental orientation field ${field.id} cannot anchor part ${part.id} element ${element.id}: element has fewer than two authored nodes`,
    );
  }
  const stats = collectAnchorStats(part, field, element, nodePositions);
  const referenceLength = Math.hypot(
    stats.maxX - stats.minX,
    stats.maxY - stats.minY,
    stats.maxZ - stats.minZ,
  );
  if (!Number.isFinite(referenceLength) || referenceLength <= 0) {
    throw new Error(
      `Elemental orientation field ${field.id} cannot anchor part ${part.id} element ${element.id}: element has zero extent`,
    );
  }
  return {
    x: stats.sumX / stats.count,
    y: stats.sumY / stats.count,
    z: stats.sumZ / stats.count,
    referenceLength,
  };
}

function collectAnchorStats(
  part: Part,
  field: { readonly id: string },
  element: OrientationTopologyElement,
  nodePositions: Float32Array,
): AnchorStats {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const nodeId of element.nodeIds) {
    const offset = nodeId * 3;
    const x = nodePositions[offset];
    const y = nodePositions[offset + 1];
    const z = nodePositions[offset + 2];
    if (x === undefined || y === undefined || z === undefined) {
      throw new Error(
        `Elemental orientation field ${field.id} cannot anchor part ${part.id} element ${element.id}: node ${nodeId} is outside nodePositions`,
      );
    }
    sumX += x;
    sumY += y;
    sumZ += z;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return {
    count: element.nodeIds.length,
    sumX,
    sumY,
    sumZ,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
  };
}

function createTopologyElement(
  part: Part,
  element: ElementTessellation,
): OrientationTopologyElement {
  const geometries = part.geometries.filter((geometry) => geometry.nodePickIds !== undefined);
  if (geometries.length === 0) {
    return { id: element.id, bodyId: element.bodyId, nodeIds: [] };
  }
  const nodes = new Set<number>();
  for (const geometry of geometries) {
    addGeometryElementNodes(part, element, geometry, nodes);
  }
  return {
    id: element.id,
    bodyId: element.bodyId,
    nodeIds: [...nodes].sort((left, right) => left - right),
  };
}

function addGeometryElementNodes(
  part: Part,
  element: ElementTessellation,
  geometry: Part["geometries"][number],
  nodes: Set<number>,
): void {
  const nodePickIds = geometry.nodePickIds;
  if (nodePickIds === undefined) return;
  const stride = primitiveVertexCount(geometry.primitive);
  for (const range of element.primitiveRanges.filter(
    (candidate) => candidate.primitive === geometry.primitive,
  )) {
    addRangeNodes({ part, element, geometry, nodePickIds, range, stride, nodes });
  }
}

function addRangeNodes(input: {
  readonly part: Part;
  readonly element: ElementTessellation;
  readonly geometry: Part["geometries"][number];
  readonly nodePickIds: Uint32Array;
  readonly range: { readonly primitiveStart: number; readonly primitiveCount: number };
  readonly stride: number;
  readonly nodes: Set<number>;
}): void {
  const { part, element, geometry, nodePickIds, range, stride, nodes } = input;
  for (
    let primitive = range.primitiveStart;
    primitive < range.primitiveStart + range.primitiveCount;
    primitive += 1
  ) {
    const indexBase = primitive * stride;
    for (let offset = 0; offset < stride; offset += 1) {
      const vertexIndex = geometry.indices[indexBase + offset];
      const nodePickId = vertexIndex === undefined ? undefined : nodePickIds[vertexIndex];
      if (nodePickId === undefined) {
        throw new Error(
          `Element ${element.id} in part ${part.id} references a vertex without a nodePickId`,
        );
      }
      if (nodePickId > 0) nodes.add(nodePickId - 1);
    }
  }
}

function primitiveVertexCount(primitive: Part["geometries"][number]["primitive"]): number {
  switch (primitive) {
    case "triangles":
      return 3;
    case "lines":
      return 2;
    case "points":
      return 1;
  }
}
