import type { Geometry, Primitive } from "./part";
import type { Vec3 } from "./vec-math";

/** Accumulates oriented triangles into flat position/index arrays. */
export class TriangleMeshBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  append(triangle: readonly [Vec3, Vec3, Vec3]): void {
    const base = this.positions.length / 3;
    for (const point of triangle) {
      this.positions.push(point[0], point[1], point[2]);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  build(primitive: Primitive): Geometry {
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      primitive,
    };
  }
}

/** Accumulates polylines into flat position/index arrays for line primitives. */
export class LineMeshBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  append(points: readonly Vec3[]): void {
    if (points.length < 2) return;
    const base = this.positions.length / 3;
    for (const point of points) {
      this.positions.push(point[0], point[1], point[2]);
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      this.indices.push(base + i, base + i + 1);
    }
  }

  build(primitive: Primitive): Geometry {
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      primitive,
    };
  }
}
