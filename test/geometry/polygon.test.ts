import { describe, expect, it } from "vitest";
import {
  polygonGeometry,
  polygonPart,
  PolygonGeometryError,
  type PolygonGeometryInput,
} from "../../src/geometry/polygon";
import { computeBounds } from "../../src/geometry/part";
import { resolvePickTarget, type PickContext, type ResolvedPickIds } from "../../src/picking/pick";
import { identity } from "../../src/math/mat4";
import { deformGeometry } from "../../src/results/deform";
import { createResultField } from "../../src/results/fields";
import type { Instance } from "../../src/scene/types";

const CONCAVE_POSITIONS = [0, 0, 0, 2, 0, 0, 2, 2, 0, 1, 1, 0, 0, 2, 0] as const;

function concaveInput(): PolygonGeometryInput {
  return {
    positions: CONCAVE_POSITIONS,
    faces: [
      {
        nodeIds: [0, 1, 2, 3, 4],
        elementId: 7,
        faceIndex: 3,
        key: "source-face",
        neighborElementIds: [99],
      },
    ],
  };
}

function ids(partial: Partial<ResolvedPickIds>): ResolvedPickIds {
  return { instancePickId: 1, elementPickId: 0, facePickId: 0, nodePickId: 0, ...partial };
}

function instance(): Instance {
  return { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() };
}

function triangleAreaSum(geometry: ReturnType<typeof polygonGeometry>): number {
  let area = 0;
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const points = [0, 1, 2].map((corner) => {
      const vertex = geometry.indices[index + corner] ?? 0;
      const offset = vertex * 3;
      return [geometry.positions[offset] ?? 0, geometry.positions[offset + 1] ?? 0] as const;
    });
    const a = points[0] as readonly [number, number];
    const b = points[1] as readonly [number, number];
    const c = points[2] as readonly [number, number];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return area;
}

function expectCode(operation: () => unknown, code: PolygonGeometryError["code"]): void {
  try {
    operation();
    throw new Error(`Expected polygon error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PolygonGeometryError);
    expect((error as PolygonGeometryError).code).toBe(code);
  }
}

describe("polygonGeometry", () => {
  it("triangulates a convex face with stable source-node picks", () => {
    const geometry = polygonGeometry({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faces: [{ nodeIds: [0, 1, 2, 3], elementId: 2 }],
    });
    expect(geometry.indices.length).toBe(6);
    expect(triangleAreaSum(geometry)).toBeCloseTo(1);
    expect(geometry.elements).toEqual([{ id: 2, primitiveStart: 0, primitiveCount: 2 }]);
    expect(geometry.faces?.[0]).toMatchObject({
      id: 0,
      elementId: 2,
      faceIndex: 0,
      key: "0,1,2,3",
      nodeIds: [0, 1, 2, 3],
    });
    expect(geometry.nodePickIds).toEqual(new Uint32Array([4, 1, 2, 2, 3, 4]));
  });

  it("triangulates a concave face deterministically and preserves ownership", () => {
    const first = polygonGeometry(concaveInput());
    const second = polygonGeometry(concaveInput());
    expect(first.indices.length).toBe(9);
    expect(triangleAreaSum(first)).toBeCloseTo(3);
    expect(first.positions).toEqual(second.positions);
    expect(first.indices).toEqual(second.indices);
    expect(first.elements).toEqual([{ id: 7, primitiveStart: 0, primitiveCount: 3 }]);
    expect(first.faces).toEqual([
      {
        id: 0,
        elementId: 7,
        faceIndex: 3,
        key: "source-face",
        nodeIds: [0, 1, 2, 3, 4],
        neighborElementIds: [99],
      },
    ]);
    expect(first.facePickIds).toEqual(new Uint32Array([1, 1, 1]));
    expect(first.nodePickIds?.every((pickId) => pickId > 0)).toBe(true);
  });

  it("groups multiple faces into one contiguous element range", () => {
    const geometry = polygonGeometry({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faces: [
        { nodeIds: [0, 1, 2], elementId: 4 },
        { nodeIds: [0, 2, 3], elementId: 4 },
      ],
      bodies: [{ id: 2, name: "shell", elementIds: [4] }],
    });
    expect(geometry.elements).toEqual([{ id: 4, primitiveStart: 0, primitiveCount: 2, bodyId: 2 }]);
    expect(geometry.faces?.map((face) => face.faceIndex)).toEqual([0, 1]);
    expect(geometry.faces?.every((face) => face.bodyId === 2)).toBe(true);
    expect(geometry.bodies).toEqual([{ id: 2, name: "shell", elementIds: [4] }]);
  });

  it("keeps node identity through picking and deformation", () => {
    const geometry = polygonGeometry(concaveInput());
    const part = { id: 1, geometry, bounds: computeBounds(geometry) };
    const context: PickContext = { instances: [instance()], parts: new Map([[1, part]]) };
    expect(
      resolvePickTarget(context, ids({ elementPickId: 8, facePickId: 1 }), "face"),
    ).toMatchObject({ kind: "face", elementId: 7, faceId: 0, key: "source-face" });

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

  it("accepts an empty polygon set as a valid no-draw part", () => {
    const geometry = polygonGeometry({ positions: [], faces: [] });
    const part = polygonPart(3, { positions: [], faces: [] });
    expect(geometry.indices.length).toBe(0);
    expect(geometry.nodePositions).toEqual(new Float32Array());
    expect(part.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
  });

  it("rejects malformed polygon input with actionable codes", () => {
    expectCode(
      () =>
        polygonGeometry({
          positions: [0, 0, 0, 1, 0, 0],
          faces: [{ nodeIds: [0, 1], elementId: 1 }],
        }),
      "too-few-nodes",
    );
    expectCode(
      () =>
        polygonGeometry({
          positions: [0, 0, 0, 2, 2, 0, 0, 2, 0, 2, 0, 0],
          faces: [{ nodeIds: [0, 1, 2, 3], elementId: 1 }],
        }),
      "self-intersecting",
    );
    expectCode(
      () =>
        polygonGeometry({
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0],
          faces: [{ nodeIds: [0, 1, 2, 3], elementId: 1 }],
        }),
      "non-planar",
    );
    expectCode(
      () =>
        polygonGeometry({
          positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
          faces: [{ nodeIds: [0, 1, 2], elementId: 1 }],
        }),
      "degenerate",
    );
    expectCode(
      () =>
        polygonGeometry({
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          faces: [{ nodeIds: [0, 1, 4], elementId: 1 }],
        }),
      "invalid-node-id",
    );
  });
});
