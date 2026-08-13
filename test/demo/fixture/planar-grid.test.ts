import { describe, expect, it } from "vitest";
import { createPlanarGridGeometry } from "../../../demo/fixture/planar-grid";

describe("createPlanarGridGeometry", () => {
  it("builds one shared-node Triangle element per primitive", () => {
    const geometry = createPlanarGridGeometry(2, {
      elementFamily: "triangle",
      withFaces: true,
    });

    expect(geometry.positions).toHaveLength(27);
    expect(geometry.nodePositions).toBe(geometry.positions);
    expect(geometry.indices).toHaveLength(24);
    expect(geometry.elements).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        primitiveStart: index,
        primitiveCount: 1,
      })),
    );
    expect(
      geometry.faces?.map(({ elementId, primitiveStart, primitiveCount }) => ({
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
    expect(geometry.indices).toContain(1);
    expect(geometry.indices).toContain(4);
    expect(new Set(geometry.elements?.map((element) => element.id))).toHaveLength(8);
  });

  it("builds one shared-node Quad element per cell and assigns bodies by element", () => {
    const geometry = createPlanarGridGeometry(2, {
      elementFamily: "quad",
      withFaces: true,
      bodyCount: 2,
    });

    expect(geometry.elements).toEqual([
      { id: 1, primitiveStart: 0, primitiveCount: 2, bodyId: 1 },
      { id: 2, primitiveStart: 2, primitiveCount: 2, bodyId: 2 },
      { id: 3, primitiveStart: 4, primitiveCount: 2, bodyId: 1 },
      { id: 4, primitiveStart: 6, primitiveCount: 2, bodyId: 2 },
    ]);
    expect(geometry.faces).toHaveLength(4);
    expect(geometry.bodies).toEqual([
      { id: 1, name: "Body 1", elementIds: [1, 3] },
      { id: 2, name: "Body 2", elementIds: [2, 4] },
    ]);
    expect(geometry.faces?.[0]?.nodeIds).toEqual([0, 1, 4, 3]);
    expect(geometry.faces?.[1]?.nodeIds).toEqual([1, 2, 5, 4]);
    expect(geometry.faces?.[0]?.nodeIds).toContain(1);
    expect(geometry.faces?.[1]?.nodeIds).toContain(1);
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
