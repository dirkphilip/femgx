import { describe, expect, it } from "vitest";
import { identityMatrix } from "../../src/math/mat4";
import {
  createPartFromExplicitTopology,
  ExplicitTopologyError,
  type ExplicitTopologyInput,
} from "../../src/entries/model";
import type { TriangleGeometry } from "../../src/geometry/part";
import { validateExplicitTopologyInput } from "../../src/geometry/explicit-topology/input";
import { resolvePickHit, type PickContext, type ResolvedPickIds } from "../../src/picking/pick";
import { deformGeometry } from "../../src/results/deform";
import { createResultField } from "../../src/results/fields";
import type { PartOccurrence } from "../../src/scene/types";

const CONCAVE_POSITIONS = [0, 0, 0, 2, 0, 0, 2, 2, 0, 1, 1, 0, 0, 2, 0] as const;

function concaveInput(): ExplicitTopologyInput {
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

function repeatedTriangleInput(records: number): ExplicitTopologyInput {
  const connectivity = new Int32Array(records * 4);
  const elementIds = new Uint32Array(records);
  const faceIndices = new Uint32Array(records);
  for (let record = 0; record < records; record += 1) {
    const offset = record * 4;
    connectivity[offset] = 3;
    connectivity[offset + 1] = 0;
    connectivity[offset + 2] = 1;
    connectivity[offset + 3] = 2;
    elementIds[record] = record;
  }
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    facets: { connectivity, elementIds, faceIndices },
  };
}

function ids(partial: Partial<ResolvedPickIds>): ResolvedPickIds {
  return { instancePickId: 1, elementPickId: 0, facePickId: 0, nodePickId: 0, ...partial };
}

function instance(): PartOccurrence {
  return { partOccurrenceId: "1/0", partId: 1, worldTransform: identityMatrix() };
}

function triangleGeometry(
  part: ReturnType<typeof createPartFromExplicitTopology>,
): TriangleGeometry {
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

function expectCode(operation: () => unknown, code: ExplicitTopologyError["code"]): void {
  try {
    operation();
    throw new Error(`Expected explicit-topology error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExplicitTopologyError);
    expect((error as ExplicitTopologyError).code).toBe(code);
  }
}

describe("createPartFromExplicitTopology", () => {
  it("compiles facets, Line3, and points into one semantic mixed part", () => {
    const part = createPartFromExplicitTopology(1, {
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
    expect([...(part.elements ?? [])]).toEqual([
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
    expect([...(triangle.faces ?? [])]).toMatchObject([
      { elementId: 7, faceIndex: 3, primitiveCount: 3, neighborElementId: 99, bodyId: 2 },
      { elementId: 8, faceIndex: 4, primitiveCount: 6, bodyId: 2 },
    ]);
    expect(triangle.edges?.get("5,6,7")?.nodeIds).toEqual([5, 6, 7]);
    expect(part.nodePositions).toHaveLength(39);
  });

  it("tessellates linear concave and quadratic Tri6 facets deterministically", () => {
    const first = createPartFromExplicitTopology(1, concaveInput());
    const second = createPartFromExplicitTopology(1, concaveInput());
    expect(triangleAreaSum(triangleGeometry(first))).toBeCloseTo(3);
    expect(triangleGeometry(first).indices).toEqual(triangleGeometry(second).indices);

    const tri6 = createPartFromExplicitTopology(2, {
      positions: [0, 0, 0, 0.5, 0, 0, 1, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0.5, 0],
      facets: { connectivity: [-6, 0, 1, 2, 3, 4, 5], elementIds: [4], faceIndices: [0] },
    });
    expect(triangleGeometry(tri6).indices).toHaveLength(12);
    expect(Array.from(triangleGeometry(tri6).edges ?? [], (edge) => edge.nodeIds)).toEqual([
      [0, 1, 2],
      [0, 5, 4],
      [2, 3, 4],
    ]);
  });

  it("keeps retained node identityMatrix through picking and deformation", () => {
    const part = createPartFromExplicitTopology(1, concaveInput());
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
    const part = createPartFromExplicitTopology(1, {
      positions,
      facets: { connectivity, elementIds: [7], faceIndices: [3] },
    });
    positions[0] = 100;
    connectivity[1] = 4;
    expect(part.nodePositions?.[0]).toBe(0);
    expect(triangleGeometry(part).faces?.at(0)?.nodeIds).toEqual([0, 1, 2, 3, 4]);

    const empty = createPartFromExplicitTopology(3, { positions: [] });
    expect(empty.geometries).toHaveLength(1);
    expect(empty.geometries[0]?.indices).toHaveLength(0);
    expect(empty.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
  });

  it("compiles one million compact facets into dense columns without record arrays", () => {
    const input = repeatedTriangleInput(1_000_000);
    const validated = validateExplicitTopologyInput(input);
    expect(validated.facets.count).toBe(1_000_000);
    expect(validated.facets.nodeOffsets).toBeInstanceOf(Uint32Array);
    expect(validated.facets.nodeIds).toBeInstanceOf(Uint32Array);
    expect(validated.facets.triangleNodeIds).toBeInstanceOf(Uint32Array);
    expect(validated.facets.triangleNodeIds).toHaveLength(3_000_000);
    expect(Object.values(validated.facets).some(Array.isArray)).toBe(false);
  });

  it("publishes one hundred thousand compact facets without record-backed geometry", () => {
    const part = createPartFromExplicitTopology(19, repeatedTriangleInput(100_000));
    const geometry = triangleGeometry(part);
    expect(geometry.positions).toHaveLength(9);
    expect(geometry.indices).toHaveLength(300_000);
    expect(part.elements?.count).toBe(100_000);
    expect(geometry.faces?.count).toBe(100_000);
    expect(geometry.edges?.count).toBe(3);
    expect(Array.isArray(part.elements)).toBe(false);
    expect(Array.isArray(geometry.faces)).toBe(false);
    expect(Array.isArray(geometry.edges)).toBe(false);
  });

  it("rejects malformed compact records with actionable codes", () => {
    const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    expectCode(
      () =>
        createPartFromExplicitTopology(1, {
          positions: triangle,
          facets: { connectivity: [3, 0, 1], elementIds: [1], faceIndices: [0] },
        }),
      "invalid-connectivity",
    );
    expectCode(
      () =>
        createPartFromExplicitTopology(1, {
          positions: triangle,
          facets: { connectivity: [-5, 0, 1, 2, 1, 0], elementIds: [1], faceIndices: [0] },
        }),
      "invalid-connectivity",
    );
    expectCode(
      () =>
        createPartFromExplicitTopology(1, {
          positions: triangle,
          facets: { connectivity: [3, 0, 1, 2], elementIds: [], faceIndices: [0] },
        }),
      "record-count-mismatch",
    );
    expectCode(
      () =>
        createPartFromExplicitTopology(1, {
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
      () =>
        createPartFromExplicitTopology(1, {
          positions: triangle,
          points: { nodeIds: [3], elementIds: [1] },
        }),
      "invalid-node-id",
    );
    expectCode(
      () =>
        createPartFromExplicitTopology(1, {
          positions: [0, 0, 0, 2, 2, 0, 0, 2, 0, 2, 0, 0],
          facets: { connectivity: [4, 0, 1, 2, 3], elementIds: [1], faceIndices: [0] },
        }),
      "self-intersecting",
    );
  });
});
