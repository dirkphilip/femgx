import { describe, expect, it } from "vitest";
import {
  surfaceModel,
  QUADRATIC_SURFACES,
  triangles,
  triangleNormal,
  dot,
  geometryFor,
  familyModel,
  createElement,
  createElementModel,
  ElementShape,
  validateElements,
  validatePickIds,
} from "./support";

describe("elementPart geometry", () => {
  it("tessellates typed triangle and quad surfaces with face ownership", () => {
    const model = surfaceModel();
    const triangle = geometryFor(familyModel(model, "triangle"), "triangle");
    const quad = geometryFor(familyModel(model, "quad"), "triangle");
    expect(triangle.indices.length).toBe(3);
    expect(quad.indices.length).toBe(6);
    expect(triangle.part.elements).toEqual([
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        shape: ElementShape.Triangle,
      },
    ]);
    expect(quad.part.elements).toEqual([
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
        shape: ElementShape.Quad,
      },
    ]);
    expect(triangle.faces?.[0]).toMatchObject({ elementId: 1, faceIndex: 0 });
    expect(quad.faces?.[0]).toMatchObject({ elementId: 2, faceIndex: 0 });
    expect(() => {
      validateElements(triangle, triangle.part.elements);
    }).not.toThrow();
    expect(() => {
      validateElements(quad, quad.part.elements);
    }).not.toThrow();
    expect(() => {
      validatePickIds(triangle, triangle.part.elements, triangle.part.nodePositions);
    }).not.toThrow();
    expect(() => {
      validatePickIds(quad, quad.part.elements, quad.part.nodePositions);
    }).not.toThrow();
  });

  it.each(QUADRATIC_SURFACES)(
    "tessellates $name through every authored mid-edge node",
    ({ shape, nodes, triangles: triangleCount }) => {
      const element = createElement(
        1,
        shape,
        Array.from({ length: nodes.length / 3 }, (_, i) => i),
      );
      const geometry = geometryFor(createElementModel(nodes, [element]), "triangle");
      expect(geometry.indices).toHaveLength(triangleCount * 3);
      expect(geometry.part.elements).toEqual([
        {
          id: 1,
          primitiveRanges: [
            { primitive: "triangles", primitiveStart: 0, primitiveCount: triangleCount },
          ],
          shape,
        },
      ]);
      expect(new Set(geometry.nodePickIds)).toEqual(
        new Set(Array.from({ length: nodes.length / 3 }, (_, id) => id + 1)),
      );
      for (const triangle of triangles(geometry)) {
        expect(dot(triangleNormal(triangle), [0, 0, 1])).toBeGreaterThan(0);
      }
    },
  );
});
