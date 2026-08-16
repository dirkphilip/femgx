import type { ElementId, NodeId } from "../elements/element";
import type { GeometryBody } from "./part";
import { MAX_ONE_BASED_ID } from "./id-validation";
import { SurfacePartError, triangulatePolygon } from "./polygon-triangulation";
import { quadraticSubdivision } from "./face-tessellation";

/** Host-reduced mixed topology for one reusable finite-element part. */
export interface SurfacePartInput {
  /** Flat xyz coordinates indexed by every compact connectivity value. */
  readonly positions: ArrayLike<number>;
  /** Count-prefixed polygon records plus aligned element and face ownership. */
  readonly facets?: {
    /** Positive counts are linear; `-6` and `-8` are interleaved quadratic loops. */
    readonly connectivity: ArrayLike<number>;
    readonly elementIds: ArrayLike<ElementId>;
    readonly faceIndices: ArrayLike<number>;
    /** Aligned count-prefixed records containing zero or one neighbor element id. */
    readonly neighbors?: ArrayLike<number>;
  };
  /** Count-prefixed `2, a, b` or `3, a, mid, b` records. */
  readonly lines?: {
    readonly connectivity: ArrayLike<number>;
    readonly elementIds: ArrayLike<ElementId>;
  };
  /** Node indices plus aligned element ownership. */
  readonly points?: {
    readonly nodeIds: ArrayLike<NodeId>;
    readonly elementIds: ArrayLike<ElementId>;
  };
  readonly bodies?: readonly GeometryBody[];
}

type SurfaceFacetRecords = NonNullable<SurfacePartInput["facets"]>;
type SurfaceLineRecords = NonNullable<SurfacePartInput["lines"]>;
type SurfacePointRecords = NonNullable<SurfacePartInput["points"]>;

export interface SurfaceFacetRecord {
  readonly nodeIds: readonly NodeId[];
  readonly triangles: readonly (readonly [NodeId, NodeId, NodeId])[];
  readonly quadratic: boolean;
  readonly elementId: ElementId;
  readonly faceIndex: number;
  readonly neighbors: readonly ElementId[];
}

export interface SurfaceLineRecord {
  readonly nodeIds: readonly NodeId[];
  readonly elementId: ElementId;
}

export interface ValidatedSurfacePartInput {
  readonly positions: Float32Array;
  readonly facets: readonly SurfaceFacetRecord[];
  readonly lines: readonly SurfaceLineRecord[];
  readonly points: readonly SurfaceLineRecord[];
}

/** Validates compact records once and copies positions into part-owned storage. */
export function validateSurfacePartInput(input: SurfacePartInput): ValidatedSurfacePartInput {
  const positions = copyPositions(input.positions);
  return {
    positions,
    facets: readFacets(input.facets, positions),
    lines: readLines(input.lines, positions.length / 3),
    points: readPoints(input.points, positions.length / 3),
  };
}

function copyPositions(input: ArrayLike<number>): Float32Array {
  if (input.length % 3 !== 0) {
    throw new SurfacePartError(
      "invalid-positions",
      `Surface positions length must be a multiple of 3 but got ${input.length}`,
    );
  }
  const positions = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new SurfacePartError(
        "invalid-positions",
        `Surface position ${index} must be finite, got ${String(value)}`,
      );
    }
    positions[index] = value;
    if (!Number.isFinite(positions[index])) {
      throw new SurfacePartError(
        "invalid-positions",
        `Surface position ${index} cannot be represented as a Float32 value`,
      );
    }
  }
  return positions;
}

function readFacets(
  input: SurfaceFacetRecords | undefined,
  positions: Float32Array,
): readonly SurfaceFacetRecord[] {
  if (input === undefined) return [];
  const loops = readConnectivity(input.connectivity, "facet", validFacetCount);
  validateAlignedCount("facet elementIds", input.elementIds.length, loops.length);
  validateAlignedCount("facet faceIndices", input.faceIndices.length, loops.length);
  const neighbors = readNeighbors(input.neighbors, loops.length);
  const faces = loops.map(({ count, nodeIds }, index) => {
    const elementId = requiredElementId(input.elementIds, index, "Facet");
    const faceIndex = requiredFaceIndex(input.faceIndices, index, elementId);
    const adjacent = neighbors[index] ?? [];
    if (adjacent[0] === elementId) {
      throw new SurfacePartError(
        "invalid-element-id",
        `Facet ${elementId}/${faceIndex} cannot neighbor its owning element`,
      );
    }
    return {
      nodeIds,
      triangles: facetTriangles(count, nodeIds, positions),
      quadratic: count < 0,
      elementId,
      faceIndex,
      neighbors: adjacent,
    };
  });
  validateUniqueFaces(faces);
  return faces;
}

function readLines(
  input: SurfaceLineRecords | undefined,
  nodeCount: number,
): readonly SurfaceLineRecord[] {
  if (input === undefined) return [];
  const records = readConnectivity(
    input.connectivity,
    "line",
    (count) => count === 2 || count === 3,
  );
  validateAlignedCount("line elementIds", input.elementIds.length, records.length);
  return records.map(({ nodeIds }, index) => {
    validateNodeIds(nodeIds, nodeCount, "Line");
    return { nodeIds, elementId: requiredElementId(input.elementIds, index, "Line") };
  });
}

function readPoints(
  input: SurfacePointRecords | undefined,
  nodeCount: number,
): readonly SurfaceLineRecord[] {
  if (input === undefined) return [];
  validateAlignedCount("point elementIds", input.elementIds.length, input.nodeIds.length);
  return Array.from({ length: input.nodeIds.length }, (_, index) => {
    const nodeId = input.nodeIds[index] as number;
    validateNodeIds([nodeId], nodeCount, "Point");
    return {
      nodeIds: [nodeId],
      elementId: requiredElementId(input.elementIds, index, "Point"),
    };
  });
}

function readConnectivity(
  input: ArrayLike<number>,
  label: string,
  validCount: (count: number) => boolean,
): readonly { readonly count: number; readonly nodeIds: readonly NodeId[] }[] {
  const records: { count: number; nodeIds: NodeId[] }[] = [];
  for (let offset = 0; offset < input.length;) {
    const count = input[offset];
    if (count === undefined || !Number.isSafeInteger(count) || !validCount(count)) {
      throw new SurfacePartError(
        "invalid-connectivity",
        `Surface ${label} record ${records.length} has unsupported node count ${String(count)}`,
      );
    }
    const size = Math.abs(count);
    if (offset + size >= input.length) {
      throw new SurfacePartError(
        "invalid-connectivity",
        `Surface ${label} record ${records.length} is truncated`,
      );
    }
    records.push({
      count,
      nodeIds: Array.from({ length: size }, (_, index) => input[offset + index + 1] as number),
    });
    offset += size + 1;
  }
  return records;
}

function readNeighbors(
  input: ArrayLike<number> | undefined,
  facetCount: number,
): readonly (readonly ElementId[])[] {
  if (input === undefined) return Array.from({ length: facetCount }, () => []);
  const records: ElementId[][] = [];
  for (let offset = 0; offset < input.length;) {
    const count = input[offset];
    if (count !== 0 && count !== 1) {
      throw new SurfacePartError(
        "invalid-connectivity",
        `Surface neighbor record ${records.length} must contain zero or one element`,
      );
    }
    if (count === 0) {
      records.push([]);
      offset += 1;
    } else {
      if (offset + 1 >= input.length) {
        throw new SurfacePartError(
          "invalid-connectivity",
          `Surface neighbor record ${records.length} is truncated`,
        );
      }
      records.push([requiredElementId(input, offset + 1, `Neighbor ${records.length}`)]);
      offset += 2;
    }
  }
  validateAlignedCount("neighbor records", records.length, facetCount);
  return records;
}

function validFacetCount(count: number): boolean {
  return count >= 3 || count === -6 || count === -8;
}

function facetTriangles(
  count: number,
  nodeIds: readonly NodeId[],
  positions: Float32Array,
): readonly (readonly [NodeId, NodeId, NodeId])[] {
  if (count > 0) return triangulatePolygon(nodeIds, positions);
  validateNodeIds(nodeIds, positions.length / 3, "Quadratic facet");
  const corners = nodeIds.filter((_, index) => index % 2 === 0);
  triangulatePolygon(corners, positions);
  return quadraticSubdivision(nodeIds);
}

function requiredElementId(input: ArrayLike<number>, index: number, label: string): ElementId {
  const id = input[index];
  if (!Number.isSafeInteger(id) || (id as number) < 0 || (id as number) > MAX_ONE_BASED_ID) {
    throw new SurfacePartError(
      "invalid-element-id",
      `${label} element id must be an integer in [0, ${MAX_ONE_BASED_ID}], got ${String(id)}`,
    );
  }
  return id as ElementId;
}

function requiredFaceIndex(input: ArrayLike<number>, index: number, elementId: ElementId): number {
  const faceIndex = input[index];
  if (!Number.isSafeInteger(faceIndex) || (faceIndex as number) < 0) {
    throw new SurfacePartError(
      "invalid-face-index",
      `Element ${elementId} has invalid face index ${String(faceIndex)}`,
    );
  }
  return faceIndex as number;
}

function validateAlignedCount(label: string, actual: number, expected: number): void {
  if (actual === expected) return;
  throw new SurfacePartError(
    "record-count-mismatch",
    `Surface ${label} has ${actual} entries for ${expected} records`,
  );
}

function validateNodeIds(nodeIds: readonly NodeId[], nodeCount: number, label: string): void {
  const seen = new Set<NodeId>();
  for (const nodeId of nodeIds) {
    if (!Number.isSafeInteger(nodeId) || nodeId < 0 || nodeId >= nodeCount) {
      throw new SurfacePartError(
        "invalid-node-id",
        `${label} references node ${String(nodeId)}, outside 0..${Math.max(0, nodeCount - 1)}`,
      );
    }
    if (seen.has(nodeId)) {
      throw new SurfacePartError("duplicate-node", `${label} references node ${nodeId} twice`);
    }
    seen.add(nodeId);
  }
}

function validateUniqueFaces(records: readonly SurfaceFacetRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    const identity = `${record.elementId}/${record.faceIndex}`;
    if (seen.has(identity)) {
      throw new SurfacePartError("duplicate-face", `Surface repeats oriented face ${identity}`);
    }
    seen.add(identity);
  }
}
