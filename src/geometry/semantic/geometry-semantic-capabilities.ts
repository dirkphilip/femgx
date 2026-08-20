import type { FaceIdRef } from "../../elements/faces";
import type {
  FaceTessellation,
  GeometryEdge,
  GeometryEdges,
  GeometryFaceSubset,
  GeometryFaces,
} from "../types";
import type { PartSemanticGraph } from "./part-semantic-graph";
import { geometrySemanticGraph } from "./part-semantic-graph";
import { graphEdgeAt, graphFaceAt } from "./part-semantic-views";

export type { GeometryFaces } from "../types";
export type { GeometryFaceSubset } from "../types";
export type { GeometryEdges } from "../types";

/** Creates per-geometry semantic query capabilities from the canonical graph. */
export function geometrySemanticCapabilities(
  graph: PartSemanticGraph,
  geometryOrdinal: number,
): {
  readonly faces: GeometryFaces;
  readonly edges: GeometryEdges;
  readonly faceSubset: GeometryFaceSubset | undefined;
} {
  const faces = new GraphGeometryFaces(graph, geometryOrdinal);
  const edges = new GraphGeometryEdges(graph, geometryOrdinal);
  const subset = new GraphGeometryFaceSubset(graph, geometryOrdinal);
  return {
    faces,
    edges,
    faceSubset: (graph.faceSubsetDefined[geometryOrdinal] ?? 0) === 1 ? subset : undefined,
  };
}

/** Resolves one retained geometry leaf's semantic capability, when FE-authored. */
export function semanticCapabilitiesForGeometry(geometry: object):
  | {
      readonly faces: GeometryFaces;
      readonly edges: GeometryEdges;
      readonly faceSubset: GeometryFaceSubset | undefined;
    }
  | undefined {
  const owner = geometrySemanticGraph(geometry);
  return owner === undefined
    ? undefined
    : geometrySemanticCapabilities(owner.graph, owner.geometryOrdinal);
}

class GraphGeometryFaces implements GeometryFaces {
  constructor(
    private readonly graph: PartSemanticGraph,
    private readonly geometry: number,
  ) {}
  get count(): number {
    return geometryCount(this.graph.faceGeometryOffsets, this.geometry);
  }
  get(elementId: number, faceIndex: number): FaceTessellation | undefined {
    for (const [, face] of this.entries())
      if (face.elementId === elementId && face.faceIndex === faceIndex) return face;
    return undefined;
  }
  at(ordinal: number): FaceTessellation | undefined {
    const row = geometryRow(this.graph.faceGeometryOffsets, this.geometry, ordinal);
    return row === undefined ? undefined : graphFaceAt(this.graph, row);
  }
  *entries(): IterableIterator<[number, FaceTessellation]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const face = this.at(ordinal);
      if (face === undefined) throw new Error(`Part graph has invalid geometry face ${ordinal}`);
      yield [ordinal, face];
    }
  }
  *[Symbol.iterator](): IterableIterator<FaceTessellation> {
    for (const [, face] of this.entries()) yield face;
  }
}

class GraphGeometryEdges implements GeometryEdges {
  constructor(
    private readonly graph: PartSemanticGraph,
    private readonly geometry: number,
  ) {}
  get count(): number {
    return geometryCount(this.graph.edgeGeometryOffsets, this.geometry);
  }
  get(key: string): GeometryEdge | undefined {
    for (const [, edge] of this.entries()) if (edge.key === key) return edge;
    return undefined;
  }
  at(ordinal: number): GeometryEdge | undefined {
    const row = geometryRow(this.graph.edgeGeometryOffsets, this.geometry, ordinal);
    return row === undefined ? undefined : graphEdgeAt(this.graph, row);
  }
  *entries(): IterableIterator<[number, GeometryEdge]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const edge = this.at(ordinal);
      if (edge === undefined) throw new Error(`Part graph has invalid geometry edge ${ordinal}`);
      yield [ordinal, edge];
    }
  }
  *[Symbol.iterator](): IterableIterator<GeometryEdge> {
    for (const [, edge] of this.entries()) yield edge;
  }
}

class GraphGeometryFaceSubset implements GeometryFaceSubset {
  constructor(
    private readonly graph: PartSemanticGraph,
    private readonly geometry: number,
  ) {}
  get count(): number {
    return geometryCount(this.graph.faceSubsetOffsets, this.geometry);
  }
  at(ordinal: number): FaceIdRef | undefined {
    const row = geometryRow(this.graph.faceSubsetOffsets, this.geometry, ordinal);
    const face =
      row === undefined
        ? undefined
        : graphFaceAt(this.graph, this.graph.faceSubsetOrdinals[row] ?? -1);
    return face === undefined
      ? undefined
      : Object.freeze({ elementId: face.elementId, faceIndex: face.faceIndex });
  }
  *entries(): IterableIterator<[number, FaceIdRef]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const face = this.at(ordinal);
      if (face === undefined)
        throw new Error(`Part graph has invalid geometry subset face ${ordinal}`);
      yield [ordinal, face];
    }
  }
  *[Symbol.iterator](): IterableIterator<FaceIdRef> {
    for (const [, face] of this.entries()) yield face;
  }
}

function geometryCount(offsets: Uint32Array, geometry: number): number {
  return (offsets[geometry + 1] ?? 0) - (offsets[geometry] ?? 0);
}

function geometryRow(offsets: Uint32Array, geometry: number, ordinal: number): number | undefined {
  const count = geometryCount(offsets, geometry);
  const resolved = ordinal < 0 ? count + ordinal : ordinal;
  return resolved < 0 || resolved >= count ? undefined : (offsets[geometry] ?? 0) + resolved;
}
