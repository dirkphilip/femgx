import type { Geometry } from "../../geometry/part";
import { buildElementPrimitivePickIds, type ElementTessellations } from "../picking/ids";
import type { MeshEdgeData } from "./mesh-edge-types";

interface DenseEdgeState {
  readonly sourceA: Uint32Array;
  readonly sourceB: Uint32Array;
  readonly conditionHeads: Uint32Array;
  readonly conditionCounts: Uint32Array;
  readonly conditionElements: Uint32Array;
  readonly conditionNext: Uint32Array;
  edgeCount: number;
  conditionCount: number;
}

interface EdgeTable {
  readonly firstKeys: Uint32Array;
  readonly secondKeys: Uint32Array;
  readonly edgeIds: Uint32Array;
  readonly mask: number;
}

interface DenseEdgeBuilder {
  readonly table: EdgeTable;
  readonly state: DenseEdgeState;
}

interface DenseEdgeGeometryOutput {
  readonly indices: Uint32Array;
  readonly sourceVertexIndices: Uint32Array;
  readonly edgeIds: Uint32Array;
  readonly positions: Float32Array;
}

export interface DenseUnownedEdgeBuild {
  readonly edgeData: MeshEdgeData;
  readonly primitiveElementPickIds: Uint32Array;
}

/** Builds presentation-only unowned triangle edges without JS identity objects. */
export function buildDenseUnownedEdgeData(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  elements: ElementTessellations,
): MeshEdgeData {
  return buildDenseUnownedEdges(geometry, elements).edgeData;
}

/** Retains primitive element ids for direct edge-topology packing by the upload owner. */
export function buildDenseUnownedEdges(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  elements: ElementTessellations,
): DenseUnownedEdgeBuild {
  const occurrenceCount = geometry.indices.length;
  if (occurrenceCount === 0) {
    return { edgeData: emptyEdgeData(), primitiveElementPickIds: new Uint32Array() };
  }
  const builder = { state: createState(occurrenceCount), table: createEdgeTable(occurrenceCount) };
  const elementPickIds = buildElementPrimitivePickIds(geometry, elements);
  collectEdges(geometry, elementPickIds, builder);
  return {
    edgeData: finalizeDenseEdges(geometry, builder.state),
    primitiveElementPickIds: elementPickIds,
  };
}

function collectEdges(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  elementPickIds: Uint32Array,
  builder: DenseEdgeBuilder,
): void {
  const indices = geometry.indices;
  const nodePickIds = geometry.nodePickIds;
  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    const base = triangle * 3;
    for (let corner = 0; corner < 3; corner += 1) {
      const a = indices[base + corner] ?? 0;
      const b = indices[base + ((corner + 1) % 3)] ?? 0;
      const nodeA = nodePickIds?.[a] ?? 0;
      const nodeB = nodePickIds?.[b] ?? 0;
      const identityA = nodeA !== 0 && nodeB !== 0 ? nodeA : a;
      const identityB = nodeA !== 0 && nodeB !== 0 ? nodeB : b;
      const first = identityA < identityB ? identityA : identityB;
      const second = identityA < identityB ? identityB : identityA;
      const edgeId = findOrInsertEdge(builder, first, second, a, b);
      addCondition(builder.state, edgeId, elementPickIds[triangle] ?? 0);
    }
  }
}

function findOrInsertEdge(
  builder: DenseEdgeBuilder,
  first: number,
  second: number,
  sourceA: number,
  sourceB: number,
): number {
  const { table, state } = builder;
  let slot = hashPair(first, second) & table.mask;
  for (;;) {
    const encoded = table.edgeIds[slot] ?? 0;
    if (encoded === 0) {
      const edgeId = state.edgeCount++;
      table.firstKeys[slot] = first;
      table.secondKeys[slot] = second;
      table.edgeIds[slot] = edgeId + 1;
      state.sourceA[edgeId] = sourceA;
      state.sourceB[edgeId] = sourceB;
      return edgeId;
    }
    if (table.firstKeys[slot] === first && table.secondKeys[slot] === second) {
      return encoded - 1;
    }
    slot = (slot + 1) & table.mask;
  }
}

function addCondition(state: DenseEdgeState, edgeId: number, elementPickId: number): void {
  let condition = state.conditionHeads[edgeId] ?? 0;
  while (condition !== 0) {
    if (state.conditionElements[condition - 1] === elementPickId) return;
    condition = state.conditionNext[condition - 1] ?? 0;
  }
  const conditionId = state.conditionCount++;
  state.conditionElements[conditionId] = elementPickId;
  state.conditionNext[conditionId] = state.conditionHeads[edgeId] ?? 0;
  state.conditionHeads[edgeId] = conditionId + 1;
  state.conditionCounts[edgeId] = (state.conditionCounts[edgeId] ?? 0) + 1;
}

function finalizeDenseEdges(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  state: DenseEdgeState,
): MeshEdgeData {
  const endpoints = state.edgeCount * 2;
  const output: DenseEdgeGeometryOutput = {
    indices: new Uint32Array(endpoints),
    sourceVertexIndices: new Uint32Array(endpoints),
    edgeIds: new Uint32Array(endpoints),
    positions: new Float32Array(endpoints * 3),
  };
  const bodyRanges = new Uint32Array(endpoints);
  const conditionWords = Math.max(1, state.conditionCount * 2);
  const bodyIds = new Uint32Array(conditionWords);
  const elementIds = new Uint32Array(conditionWords);
  let conditionOffset = 0;
  for (let edgeId = 0; edgeId < state.edgeCount; edgeId += 1) {
    writeEdgeGeometry(geometry, state, edgeId, output);
    conditionOffset = writeConditions(state, edgeId, conditionOffset, bodyRanges, elementIds);
  }
  return { ...output, bodyRanges, bodyIds, elementIds };
}

function writeEdgeGeometry(
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  state: DenseEdgeState,
  edgeId: number,
  output: DenseEdgeGeometryOutput,
): void {
  const endpoint = edgeId * 2;
  const a = state.sourceA[edgeId] ?? 0;
  const b = state.sourceB[edgeId] ?? 0;
  output.indices[endpoint] = endpoint;
  output.indices[endpoint + 1] = endpoint + 1;
  output.sourceVertexIndices[endpoint] = a;
  output.sourceVertexIndices[endpoint + 1] = b;
  output.edgeIds[endpoint] = edgeId;
  output.edgeIds[endpoint + 1] = edgeId;
  copyPosition(geometry.positions, a, output.positions, endpoint);
  copyPosition(geometry.positions, b, output.positions, endpoint + 1);
}

function writeConditions(
  state: DenseEdgeState,
  edgeId: number,
  offset: number,
  bodyRanges: Uint32Array,
  elementIds: Uint32Array,
): number {
  const count = state.conditionCounts[edgeId] ?? 0;
  bodyRanges[edgeId * 2] = offset;
  bodyRanges[edgeId * 2 + 1] = count;
  let condition = state.conditionHeads[edgeId] ?? 0;
  for (let index = 0; index < count; index += 1) {
    elementIds[(offset + index) * 2] = state.conditionElements[condition - 1] ?? 0;
    condition = state.conditionNext[condition - 1] ?? 0;
  }
  sortConditionElements(elementIds, offset, count);
  return offset + count;
}

function sortConditionElements(values: Uint32Array, offset: number, count: number): void {
  for (let index = 1; index < count; index += 1) {
    const value = values[(offset + index) * 2] ?? 0;
    let insert = index;
    while (insert > 0 && (values[(offset + insert - 1) * 2] ?? 0) > value) {
      values[(offset + insert) * 2] = values[(offset + insert - 1) * 2] ?? 0;
      insert -= 1;
    }
    values[(offset + insert) * 2] = value;
  }
}

function createState(capacity: number): DenseEdgeState {
  return {
    sourceA: new Uint32Array(capacity),
    sourceB: new Uint32Array(capacity),
    conditionHeads: new Uint32Array(capacity),
    conditionCounts: new Uint32Array(capacity),
    conditionElements: new Uint32Array(capacity),
    conditionNext: new Uint32Array(capacity),
    edgeCount: 0,
    conditionCount: 0,
  };
}

function createEdgeTable(occurrenceCount: number): EdgeTable {
  let capacity = 1;
  while (capacity < Math.ceil(occurrenceCount / 0.75)) capacity *= 2;
  return {
    firstKeys: new Uint32Array(capacity),
    secondKeys: new Uint32Array(capacity),
    edgeIds: new Uint32Array(capacity),
    mask: capacity - 1,
  };
}

function hashPair(first: number, second: number): number {
  const mixedFirst = Math.imul(first ^ (first >>> 16), 0x45d9f3b);
  const mixedSecond = Math.imul(second ^ (second >>> 16), 0x27d4eb2d);
  return (mixedFirst ^ mixedSecond) >>> 0;
}

function copyPosition(
  source: Float32Array,
  sourceVertexIndex: number,
  target: Float32Array,
  endpointIndex: number,
): void {
  const sourceOffset = sourceVertexIndex * 3;
  const targetOffset = endpointIndex * 3;
  target[targetOffset] = source[sourceOffset] ?? 0;
  target[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
  target[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
}

function emptyEdgeData(): MeshEdgeData {
  return {
    indices: new Uint32Array(0),
    sourceVertexIndices: new Uint32Array(0),
    edgeIds: new Uint32Array(0),
    positions: new Float32Array(0),
    bodyRanges: new Uint32Array([0, 0]),
    bodyIds: new Uint32Array([0]),
    elementIds: new Uint32Array([0]),
  };
}
