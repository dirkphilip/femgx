import { faceCornerLoops, type FaceIdRef } from "../elements/faces";
import type { ElementModel } from "../elements/model";
import {
  elementModelIdAt,
  elementModelNodeIdAt,
  elementModelTopologyAt,
} from "../elements/model-topology";
import type { DirectEdgeSources } from "./semantic/direct-edge-columns";
import type { DirectFaceSources } from "./semantic/direct-face-columns";
import { resolveDirectFaceSubset } from "./semantic/face-subset-columns";
import type { ElementSemanticFragment } from "./semantic/part-semantic-graph-builder";
import type { LineGeometryInput, PointGeometryInput, TriangleGeometryInput } from "./types";
import { appendModelFace } from "./face-tessellation";
import { LineMeshBuilder, TriangleMeshAssembler, type MeshVertex } from "./mesh-builder";
import { elementNodePosition } from "./node-position";
import { authoredEdgeSourcesForOrdinals } from "./authored-edges";

/** Inputs for one validated triangle-group geometry build. */
interface VolumeGeometryInput {
  readonly model: ElementModel;
  readonly ordinals: Uint32Array;
  readonly faceSubset: readonly FaceIdRef[] | undefined;
}

/** Builds triangle geometry for one or more compatible element shapes. */
export function volumeGeometry(input: VolumeGeometryInput): GeometryBuild<TriangleGeometryInput> {
  const { model, ordinals, faceSubset } = input;
  const tessellation = tessellateVolumeFaces(model, ordinals, faceSubset);
  return buildVolumeGeometry({
    ...tessellation,
    edgeSources: authoredEdgeSourcesForOrdinals(model, ordinals),
  });
}

interface VolumeGeometryOptions {
  readonly mesh: TriangleMeshAssembler;
  readonly fragment: ElementSemanticFragment;
  readonly faceSources: DirectFaceSources;
  readonly edgeSources: DirectEdgeSources;
  readonly faceSubsetOrdinals: Uint32Array | undefined;
}

interface GeometryBuild<T extends TriangleGeometryInput | LineGeometryInput | PointGeometryInput> {
  readonly geometry: T;
  readonly fragment: ElementSemanticFragment;
  readonly edgeSources?: DirectEdgeSources;
  readonly faceSources?: DirectFaceSources;
  readonly faceSubsetOrdinals?: Uint32Array;
}

interface VolumeTessellation {
  readonly mesh: TriangleMeshAssembler;
  readonly fragment: ElementSemanticFragment;
  readonly faceSources: DirectFaceSources;
  readonly faceSubsetOrdinals: Uint32Array | undefined;
}

function tessellateVolumeFaces(
  model: ElementModel,
  ordinals: Uint32Array,
  faceSubset: readonly FaceIdRef[] | undefined,
): VolumeTessellation {
  const layout = faceLayout(model, ordinals);
  resolveFaceNeighbors(layout);
  const faceSubsetOrdinals =
    faceSubset === undefined ? undefined : resolveDirectFaceSubset(layout.source, faceSubset);
  const mesh = new TriangleMeshAssembler();
  const elementIds = new Uint32Array(ordinals.length);
  const primitiveStarts = new Uint32Array(ordinals.length);
  const primitiveCounts = new Uint32Array(ordinals.length);
  let faceOrdinal = 0;
  let elementCount = 0;
  for (let index = 0; index < ordinals.length; index += 1) {
    const ordinal = ordinals[index] ?? 0;
    const topology = elementModelTopologyAt(model, ordinal);
    const primitiveStart = mesh.triangleCount;
    const loops = faceCornerLoops(topology.family);
    for (let faceIndex = 0; faceIndex < loops.length; faceIndex += 1) {
      const face = loops[faceIndex];
      if (face === undefined) throw new Error("Element topology has no face");
      const start = mesh.triangleCount;
      appendModelFace(mesh, model, ordinal, face);
      layout.source.primitiveStarts[faceOrdinal] = start;
      layout.source.primitiveCounts[faceOrdinal] = mesh.triangleCount - start;
      faceOrdinal += 1;
    }
    elementIds[elementCount] = elementModelIdAt(model, ordinal);
    primitiveStarts[elementCount] = primitiveStart;
    primitiveCounts[elementCount] = mesh.triangleCount - primitiveStart;
    elementCount += 1;
  }
  return {
    mesh,
    fragment: {
      primitive: "triangles",
      elementIds: elementIds.slice(0, elementCount),
      primitiveStarts: primitiveStarts.slice(0, elementCount),
      primitiveCounts: primitiveCounts.slice(0, elementCount),
    },
    faceSources: layout.source,
    faceSubsetOrdinals,
  };
}

function buildVolumeGeometry(options: VolumeGeometryOptions): GeometryBuild<TriangleGeometryInput> {
  const { mesh, fragment, edgeSources, faceSources, faceSubsetOrdinals } = options;
  const base = mesh.build("triangles");
  return {
    geometry: base,
    fragment,
    edgeSources,
    faceSources,
    ...(faceSubsetOrdinals === undefined ? {} : { faceSubsetOrdinals }),
  };
}

/** Builds element-pickable line geometry for authored line elements. */
export function lineGeometry(
  model: ElementModel,
  ordinals: Uint32Array,
): GeometryBuild<LineGeometryInput> {
  const mesh = new LineMeshBuilder();
  const elementIds = new Uint32Array(ordinals.length);
  const primitiveStarts = new Uint32Array(ordinals.length);
  const primitiveCounts = new Uint32Array(ordinals.length);
  for (let index = 0; index < ordinals.length; index += 1) {
    const ordinal = ordinals[index] ?? 0;
    const topology = elementModelTopologyAt(model, ordinal);
    const primitiveStart = mesh.indices.length / 2;
    for (let edge = 0; edge < topology.edges.length; edge += 1) {
      mesh.append(edgePoints(model, ordinal, edge));
    }
    elementIds[index] = elementModelIdAt(model, ordinal);
    primitiveStarts[index] = primitiveStart;
    primitiveCounts[index] = mesh.indices.length / 2 - primitiveStart;
  }
  const geometry: LineGeometryInput = {
    ...mesh.build("lines"),
  };
  return {
    geometry,
    fragment: { primitive: "lines", elementIds, primitiveStarts, primitiveCounts },
    edgeSources: authoredEdgeSourcesForOrdinals(model, ordinals),
  };
}

/** Builds element-pickable point sprites for authored point elements. */
export function pointGeometry(
  model: ElementModel,
  ordinals: Uint32Array,
): GeometryBuild<PointGeometryInput> {
  const positions: number[] = [];
  const indices: number[] = [];
  const nodePickIds: number[] = [];
  const elementIds = new Uint32Array(ordinals.length);
  const primitiveStarts = new Uint32Array(ordinals.length);
  const primitiveCounts = new Uint32Array(ordinals.length).fill(1);
  for (let index = 0; index < ordinals.length; index += 1) {
    const ordinal = ordinals[index] ?? 0;
    const nodeId = elementModelNodeIdAt(model, ordinal, 0);
    const point = elementNodePosition(model, nodeId);
    const primitiveStart = positions.length / 3;
    const base = positions.length / 3;
    positions.push(point[0], point[1], point[2]);
    nodePickIds.push(nodeId + 1);
    indices.push(base);
    elementIds[index] = elementModelIdAt(model, ordinal);
    primitiveStarts[index] = primitiveStart;
  }
  const geometry: PointGeometryInput = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    primitive: "points",
    nodePickIds: new Uint32Array(nodePickIds),
  };
  return {
    geometry,
    fragment: { primitive: "points", elementIds, primitiveStarts, primitiveCounts },
  };
}

interface FaceLayout {
  readonly source: DirectFaceSources;
  readonly canonicalOffsets: Uint32Array;
  readonly canonicalNodeIds: Uint32Array;
}

function faceLayout(model: ElementModel, ordinals: Uint32Array): FaceLayout {
  const sizes = faceSizes(model, ordinals);
  const source = createFaceSourceColumns(sizes.faces, sizes.nodes);
  const canonicalOffsets = new Uint32Array(sizes.faces + 1);
  const canonicalNodeIds = new Uint32Array(sizes.nodes);
  let face = 0;
  let node = 0;
  for (let index = 0; index < ordinals.length; index += 1) {
    const ordinal = ordinals[index] ?? 0;
    const topology = elementModelTopologyAt(model, ordinal);
    const id = elementModelIdAt(model, ordinal);
    const bodyId = model.elementBodyIds?.[ordinal] ?? 0;
    const loops = faceCornerLoops(topology.family);
    for (let faceIndex = 0; faceIndex < loops.length; faceIndex += 1) {
      const loop = loops[faceIndex];
      if (loop === undefined) throw new Error(`Element ${id} face ${faceIndex} is missing`);
      const count = loop.length * (topology.order >= 2 ? 2 : 1);
      source.elementIds[face] = id;
      source.faceIndices[face] = faceIndex;
      source.bodyIds[face] = bodyId;
      source.nodeOffsets[face] = node;
      canonicalOffsets[face] = node;
      const input = { model, ordinal, topology, corners: loop };
      writeFaceNodeIds(source.nodeIds, node, input);
      writeFaceNodeIds(canonicalNodeIds, node, input);
      sortSmallRange(canonicalNodeIds, node, count);
      node += count;
      face += 1;
    }
  }
  source.nodeOffsets[face] = node;
  canonicalOffsets[face] = node;
  return { source, canonicalOffsets, canonicalNodeIds };
}

function faceSizes(
  model: ElementModel,
  ordinals: Uint32Array,
): {
  readonly faces: number;
  readonly nodes: number;
} {
  let faces = 0;
  let nodes = 0;
  for (let index = 0; index < ordinals.length; index += 1) {
    const topology = elementModelTopologyAt(model, ordinals[index] ?? 0);
    const loops = faceCornerLoops(topology.family);
    faces += loops.length;
    for (let face = 0; face < loops.length; face += 1) {
      nodes += (loops[face]?.length ?? 0) * (topology.order >= 2 ? 2 : 1);
    }
  }
  return { faces, nodes };
}

function writeFaceNodeIds(
  target: Uint32Array,
  offset: number,
  input: {
    readonly model: ElementModel;
    readonly ordinal: number;
    readonly topology: ReturnType<typeof elementModelTopologyAt>;
    readonly corners: readonly number[];
  },
): void {
  const { model, ordinal, topology, corners } = input;
  const stride = topology.order >= 2 ? 2 : 1;
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index];
    const next = corners[(index + 1) % corners.length];
    if (corner === undefined || next === undefined) throw new Error("Element face has no corner");
    target[offset + index * stride] = elementModelNodeIdAt(model, ordinal, corner);
    if (stride === 2) {
      const mid = topology.edgeNodes[faceEdgeIndex(topology, corner, next)];
      if (mid === undefined) throw new Error("Quadratic face has no mid-edge node");
      target[offset + index * stride + 1] = elementModelNodeIdAt(model, ordinal, mid);
    }
  }
}

function faceEdgeIndex(
  topology: ReturnType<typeof elementModelTopologyAt>,
  first: number,
  last: number,
): number {
  for (let index = 0; index < topology.edges.length; index += 1) {
    const edge = topology.edges[index];
    if (
      edge !== undefined &&
      ((edge[0] === first && edge[1] === last) || (edge[0] === last && edge[1] === first))
    ) {
      return index;
    }
  }
  throw new Error(`Face edge ${first}-${last} is not a topology edge`);
}

function createFaceSourceColumns(faces: number, nodes: number): DirectFaceSources {
  return {
    geometryOrdinals: new Uint8Array(faces),
    elementIds: new Uint32Array(faces),
    faceIndices: new Uint32Array(faces),
    primitiveStarts: new Uint32Array(faces),
    primitiveCounts: new Uint32Array(faces),
    neighborElementIds: new Uint32Array(faces),
    bodyIds: new Uint32Array(faces),
    nodeOffsets: new Uint32Array(faces + 1),
    nodeIds: new Uint32Array(nodes),
  };
}

function sortSmallRange(values: Uint32Array, start: number, count: number): void {
  for (let index = start + 1; index < start + count; index += 1) {
    const value = values[index] ?? 0;
    let cursor = index;
    while (cursor > start && (values[cursor - 1] ?? 0) > value) {
      values[cursor] = values[cursor - 1] ?? 0;
      cursor -= 1;
    }
    values[cursor] = value;
  }
}

function resolveFaceNeighbors(layout: FaceLayout): void {
  const order = sortedFaceRows(layout);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && sameCanonicalFace(layout, order[start] ?? 0, order[end] ?? 0)) {
      end += 1;
    }
    const count = end - start;
    if (count > 2) throw nonManifoldFaceError(layout, order[start] ?? 0, count);
    if (count === 2) {
      const first = order[start] ?? 0;
      const second = order[start + 1] ?? 0;
      layout.source.neighborElementIds[first] = layout.source.elementIds[second] ?? 0;
      layout.source.neighborElementIds[second] = layout.source.elementIds[first] ?? 0;
    }
    start = end;
  }
}

function sortedFaceRows(layout: FaceLayout): Uint32Array {
  const count = layout.source.elementIds.length;
  const result = new Uint32Array(count);
  const scratch = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) result[index] = index;
  for (let width = 1; width < count; width *= 2) {
    for (let start = 0; start < count; start += width * 2) {
      mergeFaceRows(layout, result, scratch, {
        start,
        middle: Math.min(start + width, count),
        end: Math.min(start + width * 2, count),
      });
    }
    result.set(scratch);
  }
  return result;
}

function mergeFaceRows(
  layout: FaceLayout,
  source: Uint32Array,
  target: Uint32Array,
  range: { readonly start: number; readonly middle: number; readonly end: number },
): void {
  const { start, middle, end } = range;
  let left = start;
  let right = middle;
  for (let output = start; output < end; output += 1) {
    const leftRow = source[left] ?? 0;
    const rightRow = source[right] ?? 0;
    if (left < middle && (right >= end || compareCanonicalFaces(layout, leftRow, rightRow) <= 0)) {
      target[output] = leftRow;
      left += 1;
    } else {
      target[output] = rightRow;
      right += 1;
    }
  }
}

function compareCanonicalFaces(layout: FaceLayout, left: number, right: number): number {
  const leftStart = layout.canonicalOffsets[left] ?? 0;
  const leftEnd = layout.canonicalOffsets[left + 1] ?? leftStart;
  const rightStart = layout.canonicalOffsets[right] ?? 0;
  const rightEnd = layout.canonicalOffsets[right + 1] ?? rightStart;
  const shared = Math.min(leftEnd - leftStart, rightEnd - rightStart);
  for (let offset = 0; offset < shared; offset += 1) {
    const difference =
      (layout.canonicalNodeIds[leftStart + offset] ?? 0) -
      (layout.canonicalNodeIds[rightStart + offset] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftEnd - leftStart - (rightEnd - rightStart);
}

function sameCanonicalFace(layout: FaceLayout, left: number, right: number): boolean {
  return compareCanonicalFaces(layout, left, right) === 0;
}

function nonManifoldFaceError(layout: FaceLayout, row: number, count: number): Error {
  const start = layout.canonicalOffsets[row] ?? 0;
  const end = layout.canonicalOffsets[row + 1] ?? start;
  const key = Array.from(layout.canonicalNodeIds.subarray(start, end)).join(",");
  return new Error(`Non-manifold face ${key} has ${count} incident elements`);
}

function edgePoints(model: ElementModel, ordinal: number, edge: number): readonly MeshVertex[] {
  const topology = elementModelTopologyAt(model, ordinal);
  const pair = topology.edges[edge];
  if (pair === undefined) throw new Error("Element topology has no edge");
  const first = elementModelNodeIdAt(model, ordinal, pair[0]);
  const last = elementModelNodeIdAt(model, ordinal, pair[1]);
  const a = elementNodePosition(model, first);
  const b = elementNodePosition(model, last);
  if (topology.order < 2) {
    return [
      { point: a, nodeId: first },
      { point: b, nodeId: last },
    ];
  }
  const midIndex = topology.edgeNodes[edge];
  if (midIndex === undefined) throw new Error("Quadratic edge must carry its mid-edge node");
  const midNodeId = elementModelNodeIdAt(model, ordinal, midIndex);
  const mid = elementNodePosition(model, midNodeId);
  return [
    { point: a, nodeId: first },
    { point: mid, nodeId: midNodeId },
    { point: b, nodeId: last },
  ];
}
