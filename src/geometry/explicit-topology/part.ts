import { ordinalForId } from "../../elements/model-storage";
import { type Bounds, type Part, type PartId, type Primitive } from "../part";
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
  isFaceOwnedFacetColumns,
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
export type {
  ElementOwnedSurfaceFacets,
  ExplicitTopologyInput,
  FaceOwnedSurfaceFacets,
} from "./input";

/**
 * Compiles compact host-reduced facets, lines, and points into one mixed Part.
 * Positions and connectivity are copied into part-owned typed storage and may
 * be released by the caller after this function returns.
 * @category Scene and geometry
 */
export function createPartFromExplicitTopology(partId: PartId, input: ExplicitTopologyInput): Part {
  const { positions, facets, lines, points } = validateExplicitTopologyInput(input);
  const nodePickIds = sharedNodePickIds(positions.length / 3, facets, lines, points);
  const builds: SurfaceGeometryBuild<GeometryInput>[] = [];
  if (facets.count > 0) builds.push(buildFacetGeometry(facets, positions, nodePickIds));
  if (lines.count > 0) builds.push(buildLineGeometry(lines, positions, nodePickIds));
  if (points.count > 0) builds.push(buildPointGeometry(points, positions, nodePickIds));
  if (builds.length === 0) builds.push(emptyTriangleGeometry(positions, nodePickIds));
  const geometries = builds.map((build) => build.geometry);
  const columns = buildPartElementColumnsFromFragments(
    geometries,
    builds.map((build) => build.fragment),
  );
  assignBodyIds(columns, input.bodies);
  const facetBuild = builds.find((build) => build.faces !== undefined);
  const edgeSources = mergeSurfaceEdgeSources(builds);
  const graph = buildPartSemanticGraphFromColumns(geometries, columns, input.bodies, {
    ...(facetBuild?.faces === undefined ? {} : { faces: faceColumns(facetBuild.faces, columns) }),
    ...(edgeSources === undefined ? {} : { edgeSources }),
  });
  return createPartFromGraphColumns(partId, {
    geometries,
    graph,
    nodePositions: positions,
    bounds: referencedGeometryBounds(geometries),
  });
}

function buildFacetGeometry(
  columns: SurfaceFacetColumns,
  positions: Float32Array,
  nodePickIds: Uint32Array,
): SurfaceGeometryBuild<TriangleGeometryInput> {
  const starts = columns.triangleOffsets.subarray(0, columns.count);
  const counts = new Uint32Array(columns.count);
  for (let record = 0; record < columns.count; record += 1) {
    counts[record] =
      (columns.triangleOffsets[record + 1] ?? 0) - (columns.triangleOffsets[record] ?? 0);
  }
  return {
    geometry: sharedGeometry("triangles", columns.triangleNodeIds, positions, nodePickIds),
    fragment: {
      primitive: "triangles",
      elementIds: columns.elementIds,
      primitiveStarts: starts,
      primitiveCounts: counts,
    },
    ...(isFaceOwnedFacetColumns(columns)
      ? {
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
        }
      : {}),
  };
}

function buildLineGeometry(
  columns: SurfaceLineColumns,
  positions: Float32Array,
  nodePickIds: Uint32Array,
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
    geometry: sharedGeometry("lines", columns.segmentNodeIds, positions, nodePickIds),
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
  nodePickIds: Uint32Array,
): SurfaceGeometryBuild<PointGeometryInput> {
  const starts = new Uint32Array(columns.count);
  const counts = new Uint32Array(columns.count);
  for (let record = 0; record < columns.count; record += 1) {
    starts[record] = record;
    counts[record] = 1;
  }
  return {
    geometry: sharedGeometry("points", columns.nodeIds, positions, nodePickIds),
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

function sharedGeometry(
  primitive: "triangles",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
  nodePickIds: Uint32Array,
): TriangleGeometryInput;
function sharedGeometry(
  primitive: "lines",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
  nodePickIds: Uint32Array,
): LineGeometryInput;
function sharedGeometry(
  primitive: "points",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
  nodePickIds: Uint32Array,
): PointGeometryInput;
function sharedGeometry(
  primitive: Primitive,
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
  nodePickIds: Uint32Array,
): GeometryInput {
  return { primitive, positions: nodePositions, indices: nodeIndices, nodePickIds };
}

function emptyTriangleGeometry(
  positions: Float32Array,
  nodePickIds: Uint32Array,
): SurfaceGeometryBuild<TriangleGeometryInput> {
  return {
    geometry: {
      primitive: "triangles",
      positions,
      indices: new Uint32Array(),
      nodePickIds,
    },
    fragment: {
      primitive: "triangles",
      elementIds: new Uint32Array(),
      primitiveStarts: new Uint32Array(),
      primitiveCounts: new Uint32Array(),
    },
  };
}

function sharedNodePickIds(
  nodeCount: number,
  facets: SurfaceFacetColumns,
  lines: SurfaceLineColumns,
  points: SurfacePointColumns,
): Uint32Array {
  const ids = new Uint32Array(nodeCount);
  markNodePickIds(ids, facets.nodeIds);
  markNodePickIds(ids, lines.nodeIds);
  markNodePickIds(ids, points.nodeIds);
  return ids;
}

function markNodePickIds(target: Uint32Array, nodeIds: Uint32Array): void {
  for (const nodeId of nodeIds) target[nodeId] = nodeId + 1;
}

function referencedGeometryBounds(geometries: readonly GeometryInput[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const geometry of geometries) {
    for (const vertex of geometry.indices) {
      const offset = vertex * 3;
      const x = geometry.positions[offset] ?? 0;
      const y = geometry.positions[offset + 1] ?? 0;
      const z = geometry.positions[offset + 2] ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return Number.isFinite(minX)
    ? { minX, minY, minZ, maxX, maxY, maxZ }
    : { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}
