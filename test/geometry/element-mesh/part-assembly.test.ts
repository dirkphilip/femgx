import { describe, expect, it } from "vitest";
import {
  tet4Model,
  tet10Model,
  heterogeneousModel,
  geometryFor,
  createElementModel,
  ElementShape,
  createPartFromElementModel,
  topologyFor,
} from "./support";
import { partSemanticGraph } from "@/geometry/semantic/part-semantic-graph";

describe("createPartFromElementModel metadata", () => {
  it("preserves body membership through typed volume tessellation", () => {
    const geometry = geometryFor(tet4Model(), "triangle", {
      bodies: [{ id: 3, name: "housing", elementIds: [1] }],
    });
    expect([...(geometry.part.bodies ?? [])]).toEqual([
      { id: 3, name: "housing", elementIds: [1] },
    ]);
    expect(geometry.part.elements?.at(0)).toMatchObject({ id: 1, bodyId: 3 });
    expect(Array.from(geometry.faces ?? []).every((face) => face.bodyId === 3)).toBe(true);
  });

  it("derives direct body metadata for every primitive group", () => {
    const source = heterogeneousModel();
    const model = createElementModel([...source.nodes], [...source.elements], {
      bodies: [{ id: 20, name: "assembly body", elementIds: [1, 2, 3, 4, 5, 6] }],
    });
    const part = createPartFromElementModel(20, model);
    expect([...(part.bodies ?? [])]).toEqual([
      { id: 20, name: "assembly body", elementIds: [1, 2, 3, 4, 5, 6] },
    ]);
    expect(
      [...(part.elements ?? [])]
        .filter((element) => [1, 2, 3, 4].includes(element.id))
        .every((element) => element.bodyId === 20),
    ).toBe(true);
    expect(part.elements?.get(5)?.bodyId).toBe(20);
    expect(part.elements?.get(6)?.bodyId).toBe(20);
  });

  it("compiles dense model columns without invoking public element or body queries", () => {
    const source = heterogeneousModel();
    const model = createElementModel([...source.nodes], [...source.elements], {
      bodies: [{ id: 20, name: "assembly body", elementIds: [1, 2, 3, 4, 5, 6] }],
    });
    Object.defineProperties(model, {
      elements: {
        get: () => {
          throw new Error("createPartFromElementModel must not project model element descriptors");
        },
      },
      bodies: {
        get: () => {
          throw new Error("createPartFromElementModel must not project model body descriptors");
        },
      },
    });

    const part = createPartFromElementModel(20, model);
    const graph = partSemanticGraph(part);

    expect(graph?.elementIds).toBeInstanceOf(Uint32Array);
    expect(graph?.elementBodyIds).toEqual(new Uint32Array([20, 20, 20, 20, 20, 20]));
    expect(graph?.bodyElementOrdinals).toEqual(new Uint32Array([0, 1, 2, 3, 4, 5]));
  });
});

describe("createPartFromElementModel", () => {
  it("publishes one semantic part with topology-qualified ranges", () => {
    const part = createPartFromElementModel(20, heterogeneousModel());
    expect(part.geometries.map((geometry) => geometry.primitive)).toEqual([
      "triangles",
      "lines",
      "points",
    ]);
    const elements = part.elements;
    if (elements === undefined)
      throw new Error("createPartFromElementModel did not publish elements");
    expect([...elements].map((element) => element.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...elements].map((element) => element.primitiveRanges[0]?.primitive)).toEqual([
      "triangles",
      "triangles",
      "triangles",
      "triangles",
      "lines",
      "points",
    ]);
  });

  it("groups linear surface, volume, line, and point elements without dropping ids", () => {
    const part = createPartFromElementModel(20, heterogeneousModel());
    const triangle = part.geometries.find((geometry) => geometry.primitive === "triangles");
    expect(triangle?.primitive).toBe("triangles");
    expect(
      [...(part.elements ?? [])]
        .filter((element) => [1, 2, 3, 4].includes(element.id))
        .map((element) => element.id),
    ).toEqual([1, 2, 3, 4]);
    expect(
      [...(part.elements ?? [])]
        .filter((element) => [1, 2, 3, 4].includes(element.id))
        .map((element) =>
          element.shape === undefined ? undefined : topologyFor(element.shape).family,
        ),
    ).toEqual(["triangle", "quad", "tet", "hex"]);
    expect(part.elements?.get(5)).toEqual({
      id: 5,
      primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }],
      shape: ElementShape.Line,
    });
    expect(part.elements?.get(6)).toEqual({
      id: 6,
      primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }],
      shape: ElementShape.Point,
    });
  });

  it("preserves mixed face identityMatrix and explicit face subsets", () => {
    const part = createPartFromElementModel(20, heterogeneousModel(), {
      faceSubset: [{ elementId: 3, faceIndex: 0 }],
    });
    const triangle = part.geometries.find((geometry) => geometry.primitive === "triangles");
    if (triangle?.primitive !== "triangles") throw new Error("Expected triangle geometry");
    expect(Array.from(triangle.faceSubset ?? [])).toEqual([{ elementId: 3, faceIndex: 0 }]);
    expect(triangle.faces?.at(2)).toMatchObject({ elementId: 3, faceIndex: 0 });
    expect(triangle.indices.length).toBeGreaterThan(3);
  });

  it("supports quadratic element shapes in the triangle leaf", () => {
    const quadratic = createPartFromElementModel(20, tet10Model());
    expect(quadratic.geometries[0]?.primitive).toBe("triangles");
  });

  it("keeps repeated builds deterministic and carries body membership to each group", () => {
    const model = createElementModel(
      [...heterogeneousModel().nodes],
      [...heterogeneousModel().elements],
      { bodies: [{ id: 2, name: "mixed", elementIds: [1, 2, 3, 4, 5, 6] }] },
    );
    const first = createPartFromElementModel(20, model);
    const second = createPartFromElementModel(20, model);
    expect(first.geometries[0]?.positions).toEqual(second.geometries[0]?.positions);
    expect([...(first.elements ?? [])].every((element) => element.bodyId === 2)).toBe(true);
  });
});
