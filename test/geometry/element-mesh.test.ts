import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel, type ElementModel } from "../../src/elements/model";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  type ElementFamily,
} from "../../src/elements/shapes";
import {
  elementGeometry,
  elementPart,
  elementRenderModes,
  type ElementRenderMode,
  type TessellationOptions,
} from "../../src/geometry/element-mesh";
import { validateElements, validatePickIds } from "../../src/geometry/part";

type Vec3 = readonly [number, number, number];

const TET_NODES: readonly number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

function tet4Model(): ElementModel {
  return createElementModel(TET_NODES, [createElement(1, TET4_SHAPE, [0, 1, 2, 3])]);
}

const TET10_NODES: readonly number[] = [
  ...TET_NODES,
  0.5,
  0,
  0, // node 4 on edge 0-1
  0.5,
  0.5,
  0, // node 5 on edge 1-2
  0,
  0.5,
  0, // node 6 on edge 2-0
  0,
  0,
  0.5, // node 7 on edge 0-3
  0.5,
  0,
  0.5, // node 8 on edge 1-3
  0,
  0.5,
  0.5, // node 9 on edge 2-3
];

function tet10Model(): ElementModel {
  const nodeIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return createElementModel(TET10_NODES, [createElement(1, TET10_SHAPE, nodeIds)]);
}

const HEX8_NODES: readonly number[] = [
  0,
  0,
  0, // 0
  1,
  0,
  0, // 1
  1,
  1,
  0, // 2
  0,
  1,
  0, // 3
  0,
  0,
  1, // 4
  1,
  0,
  1, // 5
  1,
  1,
  1, // 6
  0,
  1,
  1, // 7
];

function hex8Model(): ElementModel {
  return createElementModel(HEX8_NODES, [createElement(1, HEX8_SHAPE, [0, 1, 2, 3, 4, 5, 6, 7])]);
}

function hex20Model(): ElementModel {
  const nodes = [...HEX8_NODES];
  const mids: ReadonlyArray<readonly [number, number, number]> = [
    [0.5, 0, 0],
    [1, 0.5, 0],
    [0.5, 1, 0],
    [0, 0.5, 0],
    [0.5, 0, 1],
    [1, 0.5, 1],
    [0.5, 1, 1],
    [0, 0.5, 1],
    [0, 0, 0.5],
    [1, 0, 0.5],
    [1, 1, 0.5],
    [0, 1, 0.5],
  ];
  for (const mid of mids) nodes.push(...mid);
  return createElementModel(nodes, [
    createElement(
      1,
      HEX20_SHAPE,
      Array.from({ length: 20 }, (_, index) => index),
    ),
  ]);
}

/** Two tets sharing the face (0,1,2), one mirrored across that face. */
function sharedTetPairModel(): ElementModel {
  const nodes = [...TET_NODES, 0, 0, -1];
  return createElementModel(nodes, [
    createElement(1, TET4_SHAPE, [0, 1, 2, 3]),
    createElement(2, TET4_SHAPE, [0, 1, 2, 4]),
  ]);
}

function pointLineModel(): ElementModel {
  return createElementModel(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [
      createElement(1, POINT_SHAPE, [0]),
      createElement(2, POINT_SHAPE, [1]),
      createElement(3, LINE_SHAPE, [0, 1]),
      createElement(4, LINE3_SHAPE, [1, 2, 0]),
    ],
  );
}

function triangles(geometry: { readonly positions: Float32Array; readonly indices: Uint32Array }) {
  const result: Array<readonly [Vec3, Vec3, Vec3]> = [];
  for (let i = 0; i < geometry.indices.length; i += 3) {
    const index = (position: number) => {
      const offset = position * 3;
      return [
        geometry.positions[offset] ?? 0,
        geometry.positions[offset + 1] ?? 0,
        geometry.positions[offset + 2] ?? 0,
      ] as Vec3;
    };
    result.push([
      index(geometry.indices[i] ?? 0),
      index(geometry.indices[i + 1] ?? 0),
      index(geometry.indices[i + 2] ?? 0),
    ]);
  }
  return result;
}

function triangleNormal(triangle: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const [a, b, c] = triangle;
  return cross(subtract(b, a), subtract(c, a));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function containsPosition(geometry: { readonly positions: Float32Array }, point: Vec3): boolean {
  for (let i = 0; i < geometry.positions.length; i += 3) {
    if (
      Math.abs((geometry.positions[i] ?? 0) - point[0]) < 1e-9 &&
      Math.abs((geometry.positions[i + 1] ?? 0) - point[1]) < 1e-9 &&
      Math.abs((geometry.positions[i + 2] ?? 0) - point[2]) < 1e-9
    ) {
      return true;
    }
  }
  return false;
}

describe("elementRenderModes", () => {
  it("selects solid, surface, and edge modes for volume families", () => {
    expect(elementRenderModes("tet")).toEqual(["solid", "surface", "edges"]);
    expect(elementRenderModes("hex")).toEqual(["solid", "surface", "edges"]);
  });

  it("selects line and point modes for their families", () => {
    expect(elementRenderModes("line")).toEqual(["lines"]);
    expect(elementRenderModes("point")).toEqual(["points"]);
  });
});

describe("elementGeometry", () => {
  it("rejects a mode that does not belong to the family", () => {
    expect(() => elementGeometry(tet4Model(), "tet", "points")).toThrow("not supported for tet");
    expect(() => elementGeometry(tet4Model(), "point", "solid")).toThrow("not supported for point");
  });

  it("tessellates a Tet4 into four outward-facing solid triangles", () => {
    const geometry = elementGeometry(tet4Model(), "tet", "solid");
    expect(geometry.primitive).toBe("triangles");
    expect(geometry.indices.length).toBe(4 * 3);
    const centroid: Vec3 = [0.25, 0.25, 0.25];
    for (const triangle of triangles(geometry)) {
      const centroidToFace = subtract(triangleCenter(triangle), centroid);
      expect(dot(triangleNormal(triangle), centroidToFace)).toBeGreaterThan(0);
    }
  });

  it("renders a Tet4 surface as its four boundary triangles", () => {
    const geometry = elementGeometry(tet4Model(), "tet", "surface");
    expect(geometry.indices.length).toBe(4 * 3);
  });

  it("renders a Tet4 edge set as six unique straight edges", () => {
    const geometry = elementGeometry(tet4Model(), "tet", "edges");
    expect(geometry.primitive).toBe("lines");
    expect(geometry.indices.length).toBe(6 * 2);
    expect(geometry.positions.length / 3).toBe(6 * 2);
  });

  it("tessellates a Tet10 solid through its mid-edge nodes", () => {
    const geometry = elementGeometry(tet10Model(), "tet", "solid");
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

  it("draws quadratic edges through the mid-edge node by default", () => {
    const geometry = elementGeometry(tet10Model(), "tet", "edges");
    expect(geometry.primitive).toBe("lines");
    expect(geometry.indices.length).toBe(6 * 2 * 2);
    expect(containsPosition(geometry, [0.5, 0, 0])).toBe(true);
    expect(containsPosition(geometry, [0, 0, 0.5])).toBe(true);
  });

  it("honors edgeSegments without ever dropping the mid-edge node", () => {
    const options: TessellationOptions = { edgeSegments: 4 };
    const geometry = elementGeometry(tet10Model(), "tet", "edges", options);
    expect(geometry.indices.length).toBe(6 * 4 * 2);
    expect(containsPosition(geometry, [0.5, 0, 0])).toBe(true);
  });

  it("tessellates a Hex8 into twelve solid triangles", () => {
    const geometry = elementGeometry(hex8Model(), "hex", "solid");
    expect(geometry.primitive).toBe("triangles");
    expect(geometry.indices.length).toBe(12 * 3);
  });

  it("tessellates a Hex20 solid through its twelve mid-edge nodes", () => {
    const geometry = elementGeometry(hex20Model(), "hex", "solid");
    expect(geometry.indices.length).toBe(6 * 8 * 3);
    expect(containsPosition(geometry, [0.5, 0, 0])).toBe(true);
    expect(containsPosition(geometry, [1, 0.5, 1])).toBe(true);
    expect(containsPosition(geometry, [0, 1, 0.5])).toBe(true);
  });

  it("renders twelve unique hex edges", () => {
    const geometry = elementGeometry(hex8Model(), "hex", "edges");
    expect(geometry.indices.length).toBe(12 * 2);
  });

  it("culls the shared face between two tets in surface mode", () => {
    const model = sharedTetPairModel();
    expect(elementGeometry(model, "tet", "solid").indices.length).toBe(8 * 3);
    const surface = elementGeometry(model, "tet", "surface");
    expect(surface.indices.length).toBe(6 * 3);
  });

  it("records element tessellations so every triangle is element-pickable", () => {
    const hex = elementGeometry(hex8Model(), "hex", "solid");
    expect(hex.elements).toEqual([{ id: 1, triangleStart: 0, triangleCount: 12 }]);
    expect(() => {
      validateElements(hex);
    }).not.toThrow();

    const solid = elementGeometry(sharedTetPairModel(), "tet", "solid");
    expect(solid.elements).toEqual([
      { id: 1, triangleStart: 0, triangleCount: 4 },
      { id: 2, triangleStart: 4, triangleCount: 4 },
    ]);

    const surface = elementGeometry(sharedTetPairModel(), "tet", "surface");
    expect(surface.elements).toEqual([
      { id: 1, triangleStart: 0, triangleCount: 3 },
      { id: 2, triangleStart: 3, triangleCount: 3 },
    ]);
  });

  it("records per-vertex node pick ids and node positions", () => {
    const geometry = elementGeometry(tet4Model(), "tet", "solid");
    expect(geometry.nodePositions).toEqual(new Float32Array(TET_NODES));
    expect(geometry.nodePickIds?.length).toBe(geometry.positions.length / 3);
    const pickIds = geometry.nodePickIds;
    if (pickIds === undefined) throw new Error("expected node pick ids");
    expect(new Set(pickIds)).toEqual(new Set([1, 2, 3, 4]));
    expect(pickIds).not.toContain(0);
  });

  it("marks interpolated quadratic quad centers as non-node vertices", () => {
    const geometry = elementGeometry(hex20Model(), "hex", "solid");
    const pickIds = geometry.nodePickIds;
    if (pickIds === undefined) throw new Error("expected node pick ids");
    expect(pickIds).toContain(0);
    const vertexCount = geometry.positions.length / 3;
    expect(pickIds.length).toBe(vertexCount);
  });

  it("records face pick ids, face descriptors, and neighbors per triangle", () => {
    const solid = elementGeometry(sharedTetPairModel(), "tet", "solid");
    expect(solid.facePickIds?.length).toBe(solid.indices.length / 3);
    expect(solid.faces).toHaveLength(8);
    solid.faces?.forEach((face, index) => {
      expect(face.id).toBe(index);
      expect(face.nodeIds.length).toBeGreaterThanOrEqual(3);
      expect(face.key).toBeDefined();
    });
    expect(() => {
      validatePickIds(solid);
    }).not.toThrow();
  });

  it("reports the neighbor elements of an interior face", () => {
    const solid = elementGeometry(sharedTetPairModel(), "tet", "solid");
    const shared = solid.faces?.find(
      (face) => face.elementId === 1 && face.neighborElementIds.length > 0,
    );
    expect(shared?.neighborElementIds).toEqual([2]);
  });

  it("exposes only boundary faces in surface mode", () => {
    const surface = elementGeometry(sharedTetPairModel(), "tet", "surface");
    expect(surface.faces).toHaveLength(6);
    expect(surface.faces?.every((face) => face.neighborElementIds.length === 0)).toBe(true);
  });

  it("generates point sprites for point elements", () => {
    const geometry = elementGeometry(pointLineModel(), "point", "points");
    expect(geometry.primitive).toBe("points");
    expect(geometry.positions.length / 3).toBe(2 * 4);
    expect(geometry.indices.length).toBe(2 * 6);
    expect(containsPosition(geometry, [1, 2, 3])).toBe(true);
    expect(containsPosition(geometry, [4, 5, 6])).toBe(true);
    expect(Array.from(geometry.nodePickIds ?? [])).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it("generates line segments for line elements", () => {
    const geometry = elementGeometry(pointLineModel(), "line", "lines");
    expect(geometry.primitive).toBe("lines");
    expect(geometry.indices.length).toBe(2 + 2 * 2);
    expect(containsPosition(geometry, [1, 2, 3])).toBe(true);
    expect(containsPosition(geometry, [7, 8, 9])).toBe(true);
    expect(Array.from(geometry.nodePickIds ?? [])).toEqual([1, 2, 2, 1, 3]);
  });

  it("produces deterministic output on repeated calls", () => {
    const first = elementGeometry(tet10Model(), "tet", "solid");
    const second = elementGeometry(tet10Model(), "tet", "solid");
    expect(first.positions).toEqual(second.positions);
    expect(first.indices).toEqual(second.indices);
  });
});

describe("elementPart", () => {
  it("builds a reusable part with primitive and computed bounds", () => {
    const part = elementPart(7, tet4Model(), "tet", "edges");
    expect(part.id).toBe(7);
    expect(part.geometry.primitive).toBe("lines");
    expect(part.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 });
  });
});

function triangleCenter(triangle: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const [a, b, c] = triangle;
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

describe("element families", () => {
  it("covers every supported family with a render mode", () => {
    const families: readonly ElementFamily[] = ["point", "line", "tet", "hex"];
    const modes = new Set<ElementRenderMode>();
    for (const family of families) {
      for (const mode of elementRenderModes(family)) modes.add(mode);
    }
    expect(modes).toEqual(new Set(["solid", "surface", "edges", "lines", "points"]));
  });
});
