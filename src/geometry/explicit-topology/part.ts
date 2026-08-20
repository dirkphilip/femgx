import { ordinalForId } from "../../elements/model-storage";
import { type Part, type PartId, type Primitive } from "../part";
import { createPartFromGraphColumns } from "../part";
import {
  buildPartElementColumnsFromFragments,
  buildPartSemanticGraphFromColumns,
  type ElementSemanticFragment,
  type PartElementColumns,
} from "../semantic/part-semantic-graph-builder";
import type { DirectEdgeSources } from "../semantic/direct-edge-columns";
import {
  mergeSurfaceEdgeSources,
  surfaceFacetEdgeSources,
  surfaceLineEdgeSources,
} from "../semantic/surface-edge-fragments";
import { completeFaceColumns, type FaceColumns } from "../semantic/face-columns";
import {
  validateExplicitTopologyInput,
  type SurfaceFacetColumns,
  type SurfaceLineColumns,
  type ExplicitTopologyInput,
  type SurfacePointColumns,
} from "./input";
import type {
  GeometryInput,
  LineGeometryInput,
  PointGeometryInput,
  TriangleGeometryInput,
} from "../types";

interface SurfaceGeometryBuild<T extends GeometryInput> {
  readonly geometry: T;
  readonly fragment: ElementSemanticFragment;
  readonly faces?: SurfaceFaceFragment;
  readonly edges?: DirectEdgeSources;
}

interface SurfaceFaceFragment {
  readonly elementIds: Uint32Array;
  readonly faceIndices: Uint32Array;
  readonly primitiveStarts: Uint32Array;
  readonly primitiveCounts: Uint32Array;
  readonly neighborElementIds: Uint32Array;
  readonly neighborPresent: Uint8Array;
  readonly nodeOffsets: Uint32Array;
  readonly nodeIds: Uint32Array;
}

export { ExplicitTopologyError } from "../polygon-triangulation";
export type { ExplicitTopologyValidationCode } from "../polygon-triangulation";
export type { ExplicitTopologyInput } from "./input";

/**
 * Compiles compact host-reduced facets, lines, and points into one mixed Part.
 * Connectivity is copied into renderer-owned typed buffers and may be released
 * by the caller after this function returns.
 * @category Scene and geometry
 */
export function createPartFromExplicitTopology(partId: PartId, input: ExplicitTopologyInput): Part {
  const { positions, facets, lines, points } = validateExplicitTopologyInput(input);
  const builds: SurfaceGeometryBuild<GeometryInput>[] = [];
  if (facets.count > 0) builds.push(buildFacetGeometry(facets, positions));
  if (lines.count > 0) builds.push(buildLineGeometry(lines, positions));
  if (points.count > 0) builds.push(buildPointGeometry(points, positions));
  if (builds.length === 0) builds.push(emptyTriangleGeometry());
  const geometries = builds.map((build) => build.geometry);
  const columns = buildPartElementColumnsFromFragments(
    geometries,
    builds.map((build) => build.fragment),
  );
  assignBodyIds(columns, input.bodies);
  const facetBuild = builds[0];
  const edgeSources = mergeSurfaceEdgeSources(builds);
  const graph = buildPartSemanticGraphFromColumns(geometries, columns, input.bodies, {
    ...(facetBuild?.faces === undefined ? {} : { faces: faceColumns(facetBuild.faces, columns) }),
    ...(edgeSources === undefined ? {} : { edgeSources }),
  });
  return createPartFromGraphColumns(partId, { geometries, graph, nodePositions: positions });
}

function buildFacetGeometry(
  columns: SurfaceFacetColumns,
  positions: Float32Array,
): SurfaceGeometryBuild<TriangleGeometryInput> {
  const starts = columns.triangleOffsets.subarray(0, columns.count);
  const counts = new Uint32Array(columns.count);
  for (let record = 0; record < columns.count; record += 1) {
    counts[record] =
      (columns.triangleOffsets[record + 1] ?? 0) - (columns.triangleOffsets[record] ?? 0);
  }
  return {
    geometry: compactGeometry("triangles", columns.triangleNodeIds, positions),
    fragment: {
      primitive: "triangles",
      elementIds: columns.elementIds,
      primitiveStarts: starts,
      primitiveCounts: counts,
    },
    faces: {
      elementIds: columns.elementIds,
      faceIndices: columns.faceIndices,
      primitiveStarts: starts,
      primitiveCounts: counts,
      neighborElementIds: columns.neighborElementIds,
      neighborPresent: columns.neighborPresent,
      nodeOffsets: columns.nodeOffsets,
      nodeIds: columns.nodeIds,
    },
    edges: surfaceFacetEdgeSources(columns),
  };
}

function buildLineGeometry(
  columns: SurfaceLineColumns,
  positions: Float32Array,
): SurfaceGeometryBuild<LineGeometryInput> {
  const starts = new Uint32Array(columns.count);
  const counts = new Uint32Array(columns.count);
  let primitive = 0;
  for (let record = 0; record < columns.count; record += 1) {
    const count = (columns.nodeOffsets[record + 1] ?? 0) - (columns.nodeOffsets[record] ?? 0) - 1;
    starts[record] = primitive;
    counts[record] = count;
    primitive += count;
  }
  return {
    geometry: compactGeometry("lines", columns.segmentNodeIds, positions),
    fragment: {
      primitive: "lines",
      elementIds: columns.elementIds,
      primitiveStarts: starts,
      primitiveCounts: counts,
    },
    edges: surfaceLineEdgeSources(columns),
  };
}

function buildPointGeometry(
  columns: SurfacePointColumns,
  positions: Float32Array,
): SurfaceGeometryBuild<PointGeometryInput> {
  const starts = new Uint32Array(columns.count);
  const counts = new Uint32Array(columns.count);
  for (let record = 0; record < columns.count; record += 1) {
    starts[record] = record;
    counts[record] = 1;
  }
  return {
    geometry: compactGeometry("points", columns.nodeIds, positions),
    fragment: {
      primitive: "points",
      elementIds: columns.elementIds,
      primitiveStarts: starts,
      primitiveCounts: counts,
    },
  };
}

function faceColumns(fragment: SurfaceFaceFragment, elements: PartElementColumns): FaceColumns {
  const count = fragment.elementIds.length;
  const owners = new Uint32Array(count);
  const neighbors = new Uint32Array(count);
  const neighborMissing = new Uint8Array(count);
  const neighborMissingIds = new Uint32Array(count);
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const owner = ordinalForId(
      elements.elementIds,
      elements.elementIdOrdinals,
      fragment.elementIds[ordinal] ?? 0,
    );
    if (owner === undefined) throw new Error("Surface face has an unknown owner");
    owners[ordinal] = owner;
    if ((fragment.neighborPresent[ordinal] ?? 0) === 0) continue;
    const neighborId = fragment.neighborElementIds[ordinal] ?? 0;
    const neighbor = ordinalForId(elements.elementIds, elements.elementIdOrdinals, neighborId);
    if (neighbor === undefined) {
      neighborMissing[ordinal] = 1;
      neighborMissingIds[ordinal] = neighborId;
    } else {
      neighbors[ordinal] = neighbor + 1;
    }
  }
  return completeFaceColumns({
    faceGeometryOrdinals: new Uint8Array(count),
    faceOwnerElementOrdinals: owners,
    faceIndices: fragment.faceIndices,
    facePrimitiveStarts: fragment.primitiveStarts,
    facePrimitiveCounts: fragment.primitiveCounts,
    faceNeighborElementOrdinals: neighbors,
    faceNeighborMissing: neighborMissing,
    faceNeighborMissingIds: neighborMissingIds,
    faceBodyIds: faceBodyIds(owners, elements.elementBodyIds),
    faceNodeOffsets: fragment.nodeOffsets,
    faceNodeIds: fragment.nodeIds,
  });
}

function faceBodyIds(owners: Uint32Array, elementBodyIds: Uint32Array): Uint32Array {
  const result = new Uint32Array(owners.length);
  for (let ordinal = 0; ordinal < result.length; ordinal += 1) {
    result[ordinal] = elementBodyIds[owners[ordinal] ?? 0] ?? 0;
  }
  return result;
}

function assignBodyIds(columns: PartElementColumns, bodies: ExplicitTopologyInput["bodies"]): void {
  if (bodies === undefined) return;
  const assigned = new Uint8Array(columns.elementIds.length);
  let previousBody = 0;
  for (const body of bodies) {
    if (!Number.isSafeInteger(body.id) || body.id <= 0 || body.id <= previousBody) {
      throw new Error(`Surface bodies must have strictly ascending positive ids; got ${body.id}`);
    }
    previousBody = body.id;
    let previousElement = -1;
    for (const elementId of body.elementIds) {
      if (!Number.isSafeInteger(elementId) || elementId <= previousElement) {
        throw new Error(`Body ${body.id} element ids must be strictly ascending`);
      }
      previousElement = elementId;
      const ordinal = ordinalForId(columns.elementIds, columns.elementIdOrdinals, elementId);
      if (ordinal === undefined)
        throw new Error(`Body ${body.id} references unknown element ${elementId}`);
      if (assigned[ordinal] === 1)
        throw new Error(`Element ${elementId} belongs to more than one body`);
      assigned[ordinal] = 1;
      columns.elementBodyIds[ordinal] = body.id;
    }
  }
}

function compactGeometry(
  primitive: "triangles",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): TriangleGeometryInput;
function compactGeometry(
  primitive: "lines",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): LineGeometryInput;
function compactGeometry(
  primitive: "points",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): PointGeometryInput;
function compactGeometry(
  primitive: Primitive,
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): GeometryInput {
  const verticesByNode = new Uint32Array(nodePositions.length / 3);
  let vertexCount = 0;
  for (let index = 0; index < nodeIndices.length; index += 1) {
    const nodeId = nodeIndices[index] ?? 0;
    if ((verticesByNode[nodeId] ?? 0) === 0) verticesByNode[nodeId] = ++vertexCount;
  }
  const positions = new Float32Array(vertexCount * 3);
  const nodePickIds = new Uint32Array(vertexCount);
  for (let nodeId = 0; nodeId < verticesByNode.length; nodeId += 1) {
    const vertex = verticesByNode[nodeId] ?? 0;
    if (vertex === 0) continue;
    const source = nodeId * 3;
    const target = (vertex - 1) * 3;
    positions[target] = nodePositions[source] ?? 0;
    positions[target + 1] = nodePositions[source + 1] ?? 0;
    positions[target + 2] = nodePositions[source + 2] ?? 0;
    nodePickIds[vertex - 1] = nodeId + 1;
  }
  const indices = new Uint32Array(nodeIndices.length);
  for (let index = 0; index < nodeIndices.length; index += 1) {
    const nodeId = nodeIndices[index] ?? 0;
    indices[index] = (verticesByNode[nodeId] ?? 1) - 1;
  }
  const geometry: GeometryInput = { primitive, positions, indices, nodePickIds };
  return geometry;
}

function emptyTriangleGeometry(): SurfaceGeometryBuild<TriangleGeometryInput> {
  return {
    geometry: {
      primitive: "triangles",
      positions: new Float32Array(),
      indices: new Uint32Array(),
      nodePickIds: new Uint32Array(),
    },
    fragment: {
      primitive: "triangles",
      elementIds: new Uint32Array(),
      primitiveStarts: new Uint32Array(),
      primitiveCounts: new Uint32Array(),
    },
  };
}
