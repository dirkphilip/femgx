import { describe, expect, it } from "vitest";
import { identity } from "../../src/math/mat4";
import { surfacePart, SurfacePartError, type SurfacePartInput } from "../../src/entries/model";
import type { TriangleGeometry } from "../../src/geometry/part";
import { resolvePickHit, type PickContext, type ResolvedPickIds } from "../../src/picking/pick";
import { deformGeometry } from "../../src/results/deform";
import { createResultField } from "../../src/results/fields";
import type { PartOccurrence } from "../../src/scene/types";

const CONCAVE_POSITIONS = [0, 0, 0, 2, 0, 0, 2, 2, 0, 1, 1, 0, 0, 2, 0] as const;

function concaveInput(): SurfacePartInput {
  return {
    positions: CONCAVE_POSITIONS,
    facets: {
      connectivity: [5, 0, 1, 2, 3, 4],
      elementIds: [7],
      faceIndices: [3],
      neighbors: [1, 99],
    },
  };
}

function ids(partial: Partial<ResolvedPickIds>): ResolvedPickIds {
  return { instancePickId: 1, elementPickId: 0, facePickId: 0, nodePickId: 0, ...partial };
}

function instance(): PartOccurrence {
  return { partOccurrenceId: "1/0", partId: 1, worldTransform: identity() };
}

function triangleGeometry(part: ReturnType<typeof surfacePart>): TriangleGeometry {
  const geometry = part.geometries.find((candidate) => candidate.primitive === "triangles");
  if (geometry?.primitive !== "triangles") throw new Error("Expected triangle geometry");
  return geometry;
}

function triangleAreaSum(geometry: TriangleGeometry): number {
  let area = 0;
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const points = [0, 1, 2].map((corner) => {
      const vertex = geometry.indices[index + corner] ?? 0;
      const offset = vertex * 3;
      return [geometry.positions[offset] ?? 0, geometry.positions[offset + 1] ?? 0] as const;
    });
    const a = points[0] ?? [0, 0];
    const b = points[1] ?? [0, 0];
    const c = points[2] ?? [0, 0];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return area;
}

function expectCode(operation: () => unknown, code: SurfacePartError["code"]): void {
  try {
    operation();
    throw new Error(`Expected surface-part error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SurfacePartError);
    expect((error as SurfacePartError).code).toBe(code);
  }
}

describe("surfacePart", () => {
  it("compiles facets, Line3, and points into one semantic mixed part", () => {
    const part = surfacePart(1, {
      positions: [
        0, 0, 0, 2, 0, 0, 2, 2, 0, 1, 1, 0, 0, 2, 0, 0, 0, 1, 0.5, 0, 1, 1, 0, 1, 1, 0.5, 1, 1, 1,
        1, 0.5, 1, 1, 0, 1, 1, 0, 0.5, 1,
      ],
      facets: {
        connectivity: [5, 0, 1, 2, 3, 4, -8, 5, 6, 7, 8, 9, 10, 11, 12],
        elementIds: new Uint32Array([7, 8]),
        faceIndices: new Uint32Array([3, 4]),
        neighbors: new Int32Array([1, 99, 0]),
      },
      lines: { connectivity: new Int32Array([3, 0, 3, 4]), elementIds: [7] },
      points: { nodeIds: new Uint32Array([2]), elementIds: [7] },
      bodies: [{ id: 2, name: "retained", elementIds: [7, 8] }],
    });

    expect(part.geometries.map((geometry) => geometry.primitive)).toEqual([
      "triangles",
      "lines",
      "points",
    ]);
    expect(part.elements).toEqual([
      {
        id: 7,
        primitiveRanges: [
          { primitive: "triangles", primitiveStart: 0, primitiveCount: 3 },
          { primitive: "lines", primitiveStart: 0, primitiveCount: 2 },
          { primitive: "points", primitiveStart: 0, primitiveCount: 1 },
        ],
        bodyId: 2,
      },
      {
        id: 8,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 3, primitiveCount: 6 }],
        bodyId: 2,
      },
    ]);
    const triangle = triangleGeometry(part);
    expect(triangle.faces).toMatchObject([
      { elementId: 7, faceIndex: 3, primitiveCount: 3, neighborElementId: 99, bodyId: 2 },
      { elementId: 8, faceIndex: 4, primitiveCount: 6, bodyId: 2 },
    ]);
    expect(triangle.edges?.find((edge) => edge.key === "5,6,7")?.nodeIds).toEqual([5, 6, 7]);
    expect(part.nodePositions).toHaveLength(39);
  });

  it("tessellates linear concave and quadratic Tri6 facets deterministically", () => {
    const first = surfacePart(1, concaveInput());
    const second = surfacePart(1, concaveInput());
    expect(triangleAreaSum(triangleGeometry(first))).toBeCloseTo(3);
    expect(triangleGeometry(first).indices).toEqual(triangleGeometry(second).indices);

    const tri6 = surfacePart(2, {
      positions: [0, 0, 0, 0.5, 0, 0, 1, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0.5, 0],
      facets: { connectivity: [-6, 0, 1, 2, 3, 4, 5], elementIds: [4], faceIndices: [0] },
    });
    expect(triangleGeometry(tri6).indices).toHaveLength(12);
    expect(triangleGeometry(tri6).edges?.map((edge) => edge.nodeIds)).toEqual([
      [0, 1, 2],
      [0, 5, 4],
      [2, 3, 4],
    ]);
  });

  it("keeps retained node identity through picking and deformation", () => {
    const part = surfacePart(1, concaveInput());
    const geometry = triangleGeometry(part);
    const context: PickContext = { instances: [instance()], parts: new Map([[1, part]]) };
    expect(
      resolvePickHit(context, ids({ elementPickId: 8, facePickId: 1 }), [0, 0, 0]),
    ).toMatchObject({ kind: "face", elementId: 7, faceIndex: 3, key: "0,1,2,3,4" });

    const displacement = createResultField({
      id: "u",
      name: "displacement",
      location: "nodal",
      shape: "vector",
      count: 5,
      unit: "mm",
      values: new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    const deformed = deformGeometry(geometry, displacement);
    const movedVertex = geometry.nodePickIds?.findIndex((pickId) => pickId === 1) ?? -1;
    expect(movedVertex).toBeGreaterThanOrEqual(0);
    expect(deformed.positions[movedVertex * 3]).toBe(
      (geometry.positions[movedVertex * 3] ?? 0) + 1,
    );
    expect(deformed.indices).toBe(geometry.indices);
  });

  it("owns copied input and accepts an empty no-draw payload", () => {
    const positions = new Float64Array(CONCAVE_POSITIONS);
    const connectivity = new Int32Array([5, 0, 1, 2, 3, 4]);
    const part = surfacePart(1, {
      positions,
      facets: { connectivity, elementIds: [7], faceIndices: [3] },
    });
    positions[0] = 100;
    connectivity[1] = 4;
    expect(part.nodePositions?.[0]).toBe(0);
    expect(triangleGeometry(part).faces?.[0]?.nodeIds).toEqual([0, 1, 2, 3, 4]);

    const empty = surfacePart(3, { positions: [] });
    expect(empty.geometries).toHaveLength(1);
    expect(empty.geometries[0]?.indices).toHaveLength(0);
    expect(empty.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
  });

  it("rejects malformed compact records with actionable codes", () => {
    const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    expectCode(
      () =>
        surfacePart(1, {
          positions: triangle,
          facets: { connectivity: [3, 0, 1], elementIds: [1], faceIndices: [0] },
        }),
      "invalid-connectivity",
    );
    expectCode(
      () =>
        surfacePart(1, {
          positions: triangle,
          facets: { connectivity: [-5, 0, 1, 2, 1, 0], elementIds: [1], faceIndices: [0] },
        }),
      "invalid-connectivity",
    );
    expectCode(
      () =>
        surfacePart(1, {
          positions: triangle,
          facets: { connectivity: [3, 0, 1, 2], elementIds: [], faceIndices: [0] },
        }),
      "record-count-mismatch",
    );
    expectCode(
      () =>
        surfacePart(1, {
          positions: triangle,
          facets: {
            connectivity: [3, 0, 1, 2, 3, 0, 2, 1],
            elementIds: [1, 1],
            faceIndices: [0, 0],
          },
        }),
      "duplicate-face",
    );
    expectCode(
      () => surfacePart(1, { positions: triangle, points: { nodeIds: [3], elementIds: [1] } }),
      "invalid-node-id",
    );
    expectCode(
      () =>
        surfacePart(1, {
          positions: [0, 0, 0, 2, 2, 0, 0, 2, 0, 2, 0, 0],
          facets: { connectivity: [4, 0, 1, 2, 3], elementIds: [1], faceIndices: [0] },
        }),
      "self-intersecting",
    );
  });
});
