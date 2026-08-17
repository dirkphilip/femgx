import { describe, expect, it } from "vitest";
import {
  type Vec3,
  tet4Model,
  tet10Model,
  hex8Model,
  wedge6Model,
  pyramid5Model,
  hex20Model,
  skewedHex20Model,
  triangles,
  triangleNormal,
  subtract,
  dot,
  containsPosition,
  geometryFor,
  triangleCenter,
} from "./support";

describe("elementPart geometry", () => {
  it("tessellates a Tet4 into four outward-facing solid triangles", () => {
    const geometry = geometryFor(tet4Model(), "triangle");
    expect(geometry.primitive).toBe("triangles");
    expect(geometry.indices.length).toBe(4 * 3);
    const centroid: Vec3 = [0.25, 0.25, 0.25];
    for (const triangle of triangles(geometry)) {
      const centroidToFace = subtract(triangleCenter(triangle), centroid);
      expect(dot(triangleNormal(triangle), centroidToFace)).toBeGreaterThan(0);
    }
  });

  it("tessellates a Tet10 solid through its mid-edge nodes", () => {
    const geometry = geometryFor(tet10Model(), "triangle");
    expect(geometry.indices.length).toBe(4 * 4 * 3);
    for (const mid of [
      [0.5, 0, 0],
      [0.5, 0.5, 0],
      [0, 0.5, 0],
      [0, 0, 0.5],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ] as readonly Vec3[]) {
      expect(containsPosition(geometry, mid)).toBe(true);
    }
  });

  it("tessellates a Hex8 into twelve solid triangles", () => {
    const geometry = geometryFor(hex8Model(), "triangle");
    expect(geometry.primitive).toBe("triangles");
    expect(geometry.indices.length).toBe(12 * 3);
  });

  it.each([
    ["Wedge6", wedge6Model, 8, [1 / 3, 1 / 3, 0.5] as const],
    ["Pyramid5", pyramid5Model, 6, [0.5, 0.5, 0.2] as const],
  ] as const)(
    "tessellates a %s with authored nodes and outward facets",
    (_name, model, count, centroid) => {
      const geometry = geometryFor(model(), "triangle");
      expect(geometry.indices).toHaveLength(count * 3);
      expect(new Set(geometry.nodePickIds)).toEqual(
        new Set(Array.from({ length: model().nodes.length / 3 }, (_value, id) => id + 1)),
      );
      for (const triangle of triangles(geometry)) {
        expect(
          dot(triangleNormal(triangle), subtract(triangleCenter(triangle), centroid)),
        ).toBeGreaterThan(0);
      }
    },
  );
});

describe("elementPart geometry", () => {
  it("tessellates a Hex20 solid through its twelve mid-edge nodes", () => {
    const geometry = geometryFor(hex20Model(), "triangle");
    expect(geometry.indices.length).toBe(6 * 6 * 3);
    expect(containsPosition(geometry, [0.5, 0, 0])).toBe(true);
    expect(containsPosition(geometry, [1, 0.5, 1])).toBe(true);
    expect(containsPosition(geometry, [0, 1, 0.5])).toBe(true);
  });

  it("uses every authored Hex20 node in a deterministic six-triangle face split", () => {
    const geometry = geometryFor(hex20Model(), "triangle");
    const repeated = geometryFor(hex20Model(), "triangle");
    const nodePickIds = geometry.nodePickIds;
    if (nodePickIds === undefined) throw new Error("expected Hex20 node pick ids");
    expect(nodePickIds).not.toContain(0);
    expect(new Set(nodePickIds)).toEqual(new Set(Array.from({ length: 20 }, (_, id) => id + 1)));
    expect(geometry.indices).toEqual(repeated.indices);
  });

  it("orients every Hex20 facet outward on a non-axis-aligned cell", () => {
    const geometry = geometryFor(skewedHex20Model(), "triangle");
    const centroid: Vec3 = [0.6, 0.575, 0.55];
    for (const triangle of triangles(geometry)) {
      expect(
        dot(triangleNormal(triangle), subtract(triangleCenter(triangle), centroid)),
      ).toBeGreaterThan(0);
    }
  });
});
