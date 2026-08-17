import { describe, expect, it } from "vitest";
import {
  tet4Model,
  tet10Model,
  heterogeneousModel,
  geometryFor,
  createElementModel,
  LINE_SHAPE,
  POINT_SHAPE,
  elementPart,
} from "./support";

describe("elementPart metadata", () => {
  it("preserves body membership through typed volume tessellation", () => {
    const geometry = geometryFor(tet4Model(), "triangle", {
      bodies: [{ id: 3, name: "housing", elementIds: [1] }],
    });
    expect(geometry.part.bodies).toEqual([{ id: 3, name: "housing", elementIds: [1] }]);
    expect(geometry.part.elements?.[0]).toMatchObject({ id: 1, bodyId: 3 });
    expect(geometry.faces?.every((face) => face.bodyId === 3)).toBe(true);
  });

  it("derives direct body metadata for every primitive group", () => {
    const source = heterogeneousModel();
    const model = createElementModel([...source.nodes], source.elements, {
      bodies: [{ id: 20, name: "assembly body", elementIds: [1, 2, 3, 4, 5, 6] }],
    });
    const part = elementPart(20, model);
    expect(part.bodies).toEqual([
      { id: 20, name: "assembly body", elementIds: [1, 2, 3, 4, 5, 6] },
    ]);
    expect(
      part.elements
        ?.filter((element) => [1, 2, 3, 4].includes(element.id))
        .every((element) => element.bodyId === 20),
    ).toBe(true);
    expect(part.elements?.find((element) => element.id === 5)?.bodyId).toBe(20);
    expect(part.elements?.find((element) => element.id === 6)?.bodyId).toBe(20);
  });
});

describe("elementPart", () => {
  it("publishes one semantic part with topology-qualified ranges", () => {
    const part = elementPart(20, heterogeneousModel());
    expect(part.geometries.map((geometry) => geometry.primitive)).toEqual([
      "triangles",
      "lines",
      "points",
    ]);
    const elements = part.elements;
    if (elements === undefined) throw new Error("elementPart did not publish elements");
    expect(elements.map((element) => element.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(elements.map((element) => element.primitiveRanges[0]?.primitive)).toEqual([
      "triangles",
      "triangles",
      "triangles",
      "triangles",
      "lines",
      "points",
    ]);
  });

  it("groups linear surface, volume, line, and point elements without dropping ids", () => {
    const part = elementPart(20, heterogeneousModel());
    const triangle = part.geometries.find((geometry) => geometry.primitive === "triangles");
    expect(triangle?.primitive).toBe("triangles");
    expect(
      part.elements
        ?.filter((element) => [1, 2, 3, 4].includes(element.id))
        .map((element) => element.id),
    ).toEqual([1, 2, 3, 4]);
    expect(
      part.elements
        ?.filter((element) => [1, 2, 3, 4].includes(element.id))
        .map((element) => element.shape?.family),
    ).toEqual(["triangle", "quad", "tet", "hex"]);
    expect(part.elements?.filter((element) => element.id === 5)).toEqual([
      {
        id: 5,
        primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }],
        shape: LINE_SHAPE,
      },
    ]);
    expect(part.elements?.filter((element) => element.id === 6)).toEqual([
      {
        id: 6,
        primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }],
        shape: POINT_SHAPE,
      },
    ]);
  });

  it("preserves mixed face identity and explicit face subsets", () => {
    const part = elementPart(20, heterogeneousModel(), {
      faceSubset: [{ elementId: 3, faceIndex: 0 }],
    });
    const triangle = part.geometries.find((geometry) => geometry.primitive === "triangles");
    if (triangle?.primitive !== "triangles") throw new Error("Expected triangle geometry");
    expect(triangle.faceSubset).toEqual({
      faceIds: [{ elementId: 3, faceIndex: 0 }],
    });
    expect(triangle.faces?.[2]).toMatchObject({ elementId: 3, faceIndex: 0 });
    expect(triangle.indices.length).toBeGreaterThan(3);
  });

  it("supports quadratic element shapes in the triangle leaf", () => {
    const quadratic = elementPart(20, tet10Model());
    expect(quadratic.geometries[0]?.primitive).toBe("triangles");
  });

  it("keeps repeated builds deterministic and carries body membership to each group", () => {
    const model = createElementModel(
      [...heterogeneousModel().nodes],
      heterogeneousModel().elements,
      { bodies: [{ id: 2, name: "mixed", elementIds: [1, 2, 3, 4, 5, 6] }] },
    );
    const first = elementPart(20, model);
    const second = elementPart(20, model);
    expect(first.geometries[0]?.positions).toEqual(second.geometries[0]?.positions);
    expect(first.elements?.every((element) => element.bodyId === 2)).toBe(true);
  });
});
