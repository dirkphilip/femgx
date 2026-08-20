import type { ElementId, NodeId } from "../../elements/element";
import type { GeometryBody } from "../part";
import { MAX_ONE_BASED_ID } from "../id-validation";
import { ExplicitTopologyError } from "../polygon-triangulation";
import { validateUniqueSurfaceFaces } from "./identity";
import { validateSurfaceNodes, writeSurfaceFacetTriangles } from "./validation";

/** Host-reduced mixed topology for one reusable finite-element part. */
export interface ExplicitTopologyInput {
  /** Flat xyz coordinates indexed by every compact connectivity value. */
  readonly positions: ArrayLike<number>;
  /** Count-prefixed polygon records plus aligned element and face ownership. */
  readonly facets?: {
    /** Positive counts are linear; `-6` and `-8` are interleaved quadratic loops. */
    readonly connectivity: ArrayLike<number>;
    /** One owning element id per facet record. */
    readonly elementIds: ArrayLike<ElementId>;
    /** One zero-based face index per facet record. */
    readonly faceIndices: ArrayLike<number>;
    /** Aligned count-prefixed records containing zero or one neighbor element id. */
    readonly neighbors?: ArrayLike<number>;
  };
  /** Count-prefixed `2, a, b` or `3, a, mid, b` records. */
  readonly lines?: {
    /** Count-prefixed line connectivity records. */
    readonly connectivity: ArrayLike<number>;
    /** One owning element id per line record. */
    readonly elementIds: ArrayLike<ElementId>;
  };
  /** Node indices plus aligned element ownership. */
  readonly points?: {
    /** Compact node ids for point records. */
    readonly nodeIds: ArrayLike<NodeId>;
    /** One owning element id per point record. */
    readonly elementIds: ArrayLike<ElementId>;
  };
  /** Optional direct body ownership groups. */
  readonly bodies?: readonly GeometryBody[];
}

type SurfaceFacets = NonNullable<ExplicitTopologyInput["facets"]>;
type SurfaceLines = NonNullable<ExplicitTopologyInput["lines"]>;
type SurfacePoints = NonNullable<ExplicitTopologyInput["points"]>;

/** Dense validated facet columns retained only while explicit topology compiles. */
export interface SurfaceFacetColumns {
  readonly count: number;
  readonly nodeOffsets: Uint32Array;
  readonly nodeIds: Uint32Array;
  readonly elementIds: Uint32Array;
  readonly faceIndices: Uint32Array;
  readonly neighborElementIds: Uint32Array;
  /** A boundary has no neighbor even when element id zero is valid. */
  readonly neighborPresent: Uint8Array;
  readonly quadratic: Uint8Array;
  readonly triangleOffsets: Uint32Array;
  readonly triangleNodeIds: Uint32Array;
}

/** Dense validated line columns retained only while explicit topology compiles. */
export interface SurfaceLineColumns {
  readonly count: number;
  readonly nodeOffsets: Uint32Array;
  readonly nodeIds: Uint32Array;
  readonly elementIds: Uint32Array;
  readonly segmentNodeIds: Uint32Array;
}

/** Dense validated point columns retained only while explicit topology compiles. */
export interface SurfacePointColumns {
  readonly count: number;
  readonly nodeIds: Uint32Array;
  readonly elementIds: Uint32Array;
}

/** Fully validated, typed surface payload used by the direct part compiler. */
export interface ValidatedExplicitTopologyInput {
  readonly positions: Float32Array;
  readonly facets: SurfaceFacetColumns;
  readonly lines: SurfaceLineColumns;
  readonly points: SurfacePointColumns;
}

/**
 * Validates compact topology and writes directly into dense compiler columns.
 * General polygons retain only bounded per-polygon scratch for shared robust
 * triangulation; no model-sized record, tuple, map, or set collection escapes.
 */
export function validateExplicitTopologyInput(
  input: ExplicitTopologyInput,
): ValidatedExplicitTopologyInput {
  const positions = copyPositions(input.positions);
  const facets = readFacets(input.facets, positions);
  const lines = readLines(input.lines, positions.length / 3);
  const points = readPoints(input.points, positions.length / 3);
  return { positions, facets, lines, points };
}

function copyPositions(input: ArrayLike<number>): Float32Array {
  if (input.length % 3 !== 0) {
    throw new ExplicitTopologyError(
      "invalid-positions",
      `Surface positions length must be a multiple of 3 but got ${input.length}`,
    );
  }
  const positions = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new ExplicitTopologyError(
        "invalid-positions",
        `Surface position ${index} must be finite, got ${String(value)}`,
      );
    }
    positions[index] = value;
    if (!Number.isFinite(positions[index])) {
      throw new ExplicitTopologyError(
        "invalid-positions",
        `Surface position ${index} cannot be represented as a Float32 value`,
      );
    }
  }
  return positions;
}

function readFacets(
  input: SurfaceFacets | undefined,
  positions: Float32Array,
): SurfaceFacetColumns {
  if (input === undefined) return emptyFacets();
  const layout = countConnectivity(
    input.connectivity,
    "facet",
    validFacetCount,
    facetTriangleCount,
  );
  validateAlignedCount("facet elementIds", input.elementIds.length, layout.records);
  validateAlignedCount("facet faceIndices", input.faceIndices.length, layout.records);
  const neighbors = readNeighbors(input.neighbors, layout.records);
  const columns = createFacetColumns(layout);
  let sourceOffset = 0;
  let nodeOffset = 0;
  let triangleOffset = 0;
  for (let record = 0; record < layout.records; record += 1) {
    const count = requiredCount(input.connectivity, sourceOffset);
    const size = Math.abs(count);
    const elementId = requiredElementId(input.elementIds, record, "Facet");
    const faceIndex = requiredFaceIndex(input.faceIndices, record, elementId);
    const neighborId = neighbors.ids[record] ?? 0;
    if ((neighbors.present[record] ?? 0) === 1 && neighborId === elementId) {
      throw new ExplicitTopologyError(
        "invalid-element-id",
        `Facet ${elementId}/${faceIndex} cannot neighbor its owning element`,
      );
    }
    columns.nodeOffsets[record] = nodeOffset;
    columns.elementIds[record] = elementId;
    columns.faceIndices[record] = faceIndex;
    columns.neighborElementIds[record] = neighborId;
    columns.neighborPresent[record] = neighbors.present[record] ?? 0;
    columns.quadratic[record] = count < 0 ? 1 : 0;
    columns.triangleOffsets[record] = triangleOffset / 3;
    writeSurfaceFacetTriangles(input.connectivity, sourceOffset + 1, count, positions, {
      target: columns.triangleNodeIds,
      offset: triangleOffset,
    });
    for (let node = 0; node < size; node += 1) {
      columns.nodeIds[nodeOffset + node] = input.connectivity[sourceOffset + node + 1] ?? 0;
    }
    nodeOffset += size;
    triangleOffset += facetTriangleCount(count) * 3;
    sourceOffset += size + 1;
  }
  columns.nodeOffsets[layout.records] = nodeOffset;
  columns.triangleOffsets[layout.records] = triangleOffset / 3;
  validateUniqueSurfaceFaces(columns.elementIds, columns.faceIndices);
  return columns;
}

function readLines(input: SurfaceLines | undefined, nodeCount: number): SurfaceLineColumns {
  if (input === undefined) return emptyLines();
  const layout = countConnectivity(input.connectivity, "line", validLineCount, lineSegmentCount);
  validateAlignedCount("line elementIds", input.elementIds.length, layout.records);
  const columns = createLineColumns(layout);
  let sourceOffset = 0;
  let nodeOffset = 0;
  let segmentOffset = 0;
  for (let record = 0; record < layout.records; record += 1) {
    const count = requiredCount(input.connectivity, sourceOffset);
    validateSurfaceNodes(input.connectivity, sourceOffset + 1, count, nodeCount, "Line");
    columns.nodeOffsets[record] = nodeOffset;
    columns.elementIds[record] = requiredElementId(input.elementIds, record, "Line");
    for (let node = 0; node < count; node += 1) {
      const nodeId = input.connectivity[sourceOffset + node + 1] ?? 0;
      columns.nodeIds[nodeOffset + node] = nodeId;
      if (node + 1 < count) {
        columns.segmentNodeIds[segmentOffset++] = nodeId;
        columns.segmentNodeIds[segmentOffset++] = input.connectivity[sourceOffset + node + 2] ?? 0;
      }
    }
    nodeOffset += count;
    sourceOffset += count + 1;
  }
  columns.nodeOffsets[layout.records] = nodeOffset;
  return columns;
}

function readPoints(input: SurfacePoints | undefined, nodeCount: number): SurfacePointColumns {
  if (input === undefined) return emptyPoints();
  validateAlignedCount("point elementIds", input.elementIds.length, input.nodeIds.length);
  const nodeIds = new Uint32Array(input.nodeIds.length);
  const elementIds = new Uint32Array(input.nodeIds.length);
  for (let record = 0; record < input.nodeIds.length; record += 1) {
    validateSurfaceNodes(input.nodeIds, record, 1, nodeCount, "Point");
    nodeIds[record] = input.nodeIds[record] ?? 0;
    elementIds[record] = requiredElementId(input.elementIds, record, "Point");
  }
  return { count: nodeIds.length, nodeIds, elementIds };
}

interface ConnectivityLayout {
  readonly records: number;
  readonly nodes: number;
  readonly primitives: number;
}

function countConnectivity(
  input: ArrayLike<number>,
  label: string,
  validCount: (count: number) => boolean,
  primitiveCount: (count: number) => number,
): ConnectivityLayout {
  let records = 0;
  let nodes = 0;
  let primitives = 0;
  for (let offset = 0; offset < input.length;) {
    const count = input[offset];
    if (count === undefined || !Number.isSafeInteger(count) || !validCount(count)) {
      throw new ExplicitTopologyError(
        "invalid-connectivity",
        `Surface ${label} record ${records} has unsupported node count ${String(count)}`,
      );
    }
    const size = Math.abs(count);
    if (offset + size >= input.length) {
      throw new ExplicitTopologyError(
        "invalid-connectivity",
        `Surface ${label} record ${records} is truncated`,
      );
    }
    records += 1;
    nodes += size;
    primitives += primitiveCount(count);
    offset += size + 1;
  }
  return { records, nodes, primitives };
}

interface SurfaceNeighbors {
  readonly ids: Uint32Array;
  readonly present: Uint8Array;
}

function readNeighbors(input: ArrayLike<number> | undefined, facetCount: number): SurfaceNeighbors {
  const ids = new Uint32Array(facetCount);
  const present = new Uint8Array(facetCount);
  if (input === undefined) return { ids, present };
  let records = 0;
  for (let offset = 0; offset < input.length;) {
    const count = input[offset];
    if (count !== 0 && count !== 1) {
      throw new ExplicitTopologyError(
        "invalid-connectivity",
        `Surface neighbor record ${records} must contain zero or one element`,
      );
    }
    if (count === 1) {
      if (offset + 1 >= input.length) {
        throw new ExplicitTopologyError(
          "invalid-connectivity",
          `Surface neighbor record ${records} is truncated`,
        );
      }
      if (records < ids.length) {
        ids[records] = requiredElementId(input, offset + 1, `Neighbor ${records}`);
        present[records] = 1;
      } else {
        requiredElementId(input, offset + 1, `Neighbor ${records}`);
      }
      offset += 2;
    } else {
      offset += 1;
    }
    records += 1;
  }
  validateAlignedCount("neighbor records", records, facetCount);
  return { ids, present };
}

function createFacetColumns(layout: ConnectivityLayout): SurfaceFacetColumns {
  return {
    count: layout.records,
    nodeOffsets: new Uint32Array(layout.records + 1),
    nodeIds: new Uint32Array(layout.nodes),
    elementIds: new Uint32Array(layout.records),
    faceIndices: new Uint32Array(layout.records),
    neighborElementIds: new Uint32Array(layout.records),
    neighborPresent: new Uint8Array(layout.records),
    quadratic: new Uint8Array(layout.records),
    triangleOffsets: new Uint32Array(layout.records + 1),
    triangleNodeIds: new Uint32Array(layout.primitives * 3),
  };
}

function createLineColumns(layout: ConnectivityLayout): SurfaceLineColumns {
  return {
    count: layout.records,
    nodeOffsets: new Uint32Array(layout.records + 1),
    nodeIds: new Uint32Array(layout.nodes),
    elementIds: new Uint32Array(layout.records),
    segmentNodeIds: new Uint32Array(layout.primitives * 2),
  };
}

function emptyFacets(): SurfaceFacetColumns {
  return createFacetColumns({ records: 0, nodes: 0, primitives: 0 });
}

function emptyLines(): SurfaceLineColumns {
  return createLineColumns({ records: 0, nodes: 0, primitives: 0 });
}

function emptyPoints(): SurfacePointColumns {
  return { count: 0, nodeIds: new Uint32Array(), elementIds: new Uint32Array() };
}

function validFacetCount(count: number): boolean {
  return count >= 3 || count === -6 || count === -8;
}

function validLineCount(count: number): boolean {
  return count === 2 || count === 3;
}

function facetTriangleCount(count: number): number {
  return count > 0 ? count - 2 : count === -6 ? 4 : 6;
}

function lineSegmentCount(count: number): number {
  return count - 1;
}

function requiredCount(input: ArrayLike<number>, offset: number): number {
  return input[offset] ?? 0;
}

function requiredElementId(input: ArrayLike<number>, index: number, label: string): ElementId {
  const id = input[index];
  if (id === undefined || !Number.isSafeInteger(id) || id < 0 || id > MAX_ONE_BASED_ID) {
    throw new ExplicitTopologyError(
      "invalid-element-id",
      `${label} element id must be an integer in [0, ${MAX_ONE_BASED_ID}], got ${String(id)}`,
    );
  }
  return id;
}

function requiredFaceIndex(input: ArrayLike<number>, index: number, elementId: ElementId): number {
  const faceIndex = input[index];
  if (faceIndex === undefined || !Number.isSafeInteger(faceIndex) || faceIndex < 0) {
    throw new ExplicitTopologyError(
      "invalid-face-index",
      `Element ${elementId} has invalid face index ${String(faceIndex)}`,
    );
  }
  return faceIndex;
}

function validateAlignedCount(label: string, actual: number, expected: number): void {
  if (actual === expected) return;
  throw new ExplicitTopologyError(
    "record-count-mismatch",
    `Surface ${label} has ${actual} entries for ${expected} records`,
  );
}
