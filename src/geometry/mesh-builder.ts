import type {
  Body,
  ElementTessellation,
  FaceTessellation,
  Geometry,
  LineGeometry,
  Primitive,
  TriangleGeometry,
} from "./part";
import type { Vec3 } from "../math/vec3";

/** A tessellated triangle vertex plus the authored model node it came from. */
export interface MeshVertex {
  readonly point: Vec3;
  /** The authored model node this vertex came from. */
  readonly nodeId: number | undefined;
  /** Optional explicit identity for a generated vertex without a node. */
  readonly sourceId?: string | number;
}

/** Assembles oriented triangles into shared indexed geometry. */
export class TriangleMeshAssembler {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  /** Per-vertex node pick ids (`nodeId + 1`). */
  readonly nodePickIds: number[] = [];
  private readonly vertexBySource = new Map<string, number>();
  private generatedVertexCount = 0;

  append(triangle: readonly [MeshVertex, MeshVertex, MeshVertex]): void {
    this.indices.push(
      this.vertexIndex(triangle[0]),
      this.vertexIndex(triangle[1]),
      this.vertexIndex(triangle[2]),
    );
  }

  /** Number of triangles accumulated so far. */
  get triangleCount(): number {
    return Math.floor(this.indices.length / 3);
  }

  private vertexIndex(vertex: MeshVertex): number {
    const source = this.sourceKey(vertex);
    const existing = this.vertexBySource.get(source);
    if (existing !== undefined) return existing;
    const index = this.positions.length / 3;
    this.positions.push(vertex.point[0], vertex.point[1], vertex.point[2]);
    this.nodePickIds.push(vertex.nodeId === undefined ? 0 : vertex.nodeId + 1);
    this.vertexBySource.set(source, index);
    return index;
  }

  private sourceKey(vertex: MeshVertex): string {
    if (vertex.sourceId !== undefined) {
      return `source:${typeof vertex.sourceId}:${String(vertex.sourceId)}`;
    }
    if (vertex.nodeId !== undefined) return `node:${vertex.nodeId}`;
    const generated = `generated:${this.generatedVertexCount}`;
    this.generatedVertexCount += 1;
    return generated;
  }

  build(
    primitive: "triangles",
    elements?: readonly ElementTessellation[],
    faces?: readonly FaceTessellation[],
    nodePositions?: ArrayLike<number>,
    bodies?: readonly Body[],
  ): TriangleGeometry;
  build(
    primitive: Primitive,
    elements?: readonly ElementTessellation[],
    faces?: readonly FaceTessellation[],
    nodePositions?: ArrayLike<number>,
    bodies?: readonly Body[],
  ): Geometry {
    const hasNodeIds = this.nodePickIds.some((id) => id !== 0);
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      primitive,
      ...(elements !== undefined && elements.length > 0 ? { elements } : {}),
      ...(hasNodeIds
        ? {
            nodePickIds: new Uint32Array(this.nodePickIds),
            ...(nodePositions !== undefined
              ? { nodePositions: new Float32Array(nodePositions) }
              : {}),
          }
        : {}),
      ...(faces !== undefined && faces.length > 0 ? { faces } : {}),
      ...(bodies !== undefined && bodies.length > 0 ? { bodies } : {}),
    };
  }
}

/** Accumulates polylines into flat position/index arrays for line primitives. */
export class LineMeshBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  /** Per-vertex node pick ids (`nodeId + 1`). */
  readonly nodePickIds: number[] = [];

  append(vertices: readonly MeshVertex[]): void {
    if (vertices.length < 2) return;
    const base = this.positions.length / 3;
    for (const vertex of vertices) {
      this.positions.push(vertex.point[0], vertex.point[1], vertex.point[2]);
      this.nodePickIds.push(vertex.nodeId === undefined ? 0 : vertex.nodeId + 1);
    }
    for (let i = 0; i < vertices.length - 1; i += 1) {
      this.indices.push(base + i, base + i + 1);
    }
  }

  build(
    primitive: "lines",
    elements?: readonly ElementTessellation[],
    nodePositions?: ArrayLike<number>,
  ): LineGeometry;
  build(
    primitive: Primitive,
    elements?: readonly ElementTessellation[],
    nodePositions?: ArrayLike<number>,
  ): Geometry {
    const hasNodeIds = this.nodePickIds.some((id) => id !== 0);
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      primitive,
      ...(elements !== undefined && elements.length > 0 ? { elements } : {}),
      ...(hasNodeIds ? { nodePickIds: new Uint32Array(this.nodePickIds) } : {}),
      ...(nodePositions !== undefined ? { nodePositions: new Float32Array(nodePositions) } : {}),
    };
  }
}
