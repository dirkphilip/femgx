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
}

/** Accumulates oriented triangles into flat position/index arrays. */
export class TriangleMeshBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  /** Per-vertex node pick ids (`nodeId + 1`). */
  readonly nodePickIds: number[] = [];

  append(triangle: readonly [MeshVertex, MeshVertex, MeshVertex]): void {
    const base = this.positions.length / 3;
    for (const vertex of triangle) {
      this.positions.push(vertex.point[0], vertex.point[1], vertex.point[2]);
      this.nodePickIds.push(vertex.nodeId === undefined ? 0 : vertex.nodeId + 1);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  /** Number of triangles accumulated so far. */
  get triangleCount(): number {
    return Math.floor(this.indices.length / 3);
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
