import { describe, expect, it } from "vitest";
import { createPlanarGridGeometry } from "../../../demo/fixture/planar-grid";

describe("createPlanarGridGeometry", () => {
  it("builds one shared-node Triangle element per primitive", () => {
    const build = createPlanarGridGeometry(2, {
      elementFamily: "triangle",
      withFaces: true,
    });

    expect(build.geometry.positions).toHaveLength(27);
    expect(build.nodePositions).toBe(build.geometry.positions);
    expect(build.geometry.indices).toHaveLength(24);
    expect(build.elements).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: index, primitiveCount: 1 }],
      })),
    );
    expect(
      build.geometry.faces?.map(({ elementId, primitiveStart, primitiveCount }) => ({
        elementId,
        primitiveStart,
        primitiveCount,
      })),
    ).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        elementId: index + 1,
        primitiveStart: index,
        primitiveCount: 1,
      })),
    );
    expect(build.geometry.indices).toContain(1);
    expect(build.geometry.indices).toContain(4);
    expect(new Set(build.elements.map((element) => element.id))).toHaveLength(8);
  });

  it("builds one shared-node Quad element per cell and assigns bodies by element", () => {
    const build = createPlanarGridGeometry(2, {
      elementFamily: "quad",
      withFaces: true,
      bodyCount: 2,
    });

    expect(build.elements).toEqual([
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
        bodyId: 1,
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 2, primitiveCount: 2 }],
        bodyId: 2,
      },
      {
        id: 3,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 4, primitiveCount: 2 }],
        bodyId: 1,
      },
      {
        id: 4,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 6, primitiveCount: 2 }],
        bodyId: 2,
      },
    ]);
    expect(build.geometry.faces).toHaveLength(4);
    expect(build.bodies).toEqual([
      { id: 1, name: "Body 1", elementIds: [1, 3] },
      { id: 2, name: "Body 2", elementIds: [2, 4] },
    ]);
    expect(build.geometry.faces?.[0]?.nodeIds).toEqual([0, 1, 4, 3]);
    expect(build.geometry.faces?.[1]?.nodeIds).toEqual([1, 2, 5, 4]);
    expect(build.geometry.faces?.[0]?.nodeIds).toContain(1);
    expect(build.geometry.faces?.[1]?.nodeIds).toContain(1);
  });

  it("keeps body capacity tied to the declared element family", () => {
    expect(() => createPlanarGridGeometry(1, { elementFamily: "quad", bodyCount: 2 })).toThrow(
      "body count must be a positive integer",
    );
    expect(() => createPlanarGridGeometry(1, { elementFamily: "triangle", bodyCount: 3 })).toThrow(
      "body count must be a positive integer",
    );
  });
});
