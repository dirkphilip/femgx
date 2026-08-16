import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel, type Body, type ElementModel } from "../../src/elements/model";
import { boundaryFaceRefs, FaceSelectionError } from "../../src/elements/faces";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  PYRAMID5_SHAPE,
  QUAD8_SHAPE,
  QUAD_SHAPE,
  TRI6_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  WEDGE6_SHAPE,
  type ElementFamily,
} from "../../src/elements/shapes";
import { type TessellationOptions, elementPart } from "../../src/geometry/element-part";
import {
  validateElements,
  validatePickIds,
  type LineGeometry,
  type Part,
  type PointGeometry,
  type TriangleGeometry,
} from "../../src/geometry/part";
import { deformGeometry } from "../../src/results/deform";
import { createResultField } from "../../src/results/fields";

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

function wedge6Model(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1],
    [createElement(1, WEDGE6_SHAPE, [0, 1, 2, 3, 4, 5])],
  );
}

function pyramid5Model(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0.5, 1],
    [createElement(1, PYRAMID5_SHAPE, [0, 1, 2, 3, 4])],
  );
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

function skewedHex20Model(): ElementModel {
  const model = hex20Model();
  const nodes: number[] = [];
  for (let offset = 0; offset < model.nodes.length; offset += 3) {
    const x = model.nodes[offset] ?? 0;
    const y = model.nodes[offset + 1] ?? 0;
    const z = model.nodes[offset + 2] ?? 0;
    nodes.push(x + 0.2 * y, y + 0.15 * z, z + 0.1 * x);
  }
  return createElementModel(nodes, model.elements);
}

function surfaceModel(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0],
    [createElement(1, TRIANGLE_SHAPE, [0, 1, 2]), createElement(2, QUAD_SHAPE, [1, 3, 4, 2])],
  );
}

const QUADRATIC_SURFACES = [
  {
    name: "Tri6",
    shape: TRI6_SHAPE,
    nodes: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0, 0.2, 0.5, 0.5, 0.1, 0, 0.5, 0.2],
    triangles: 4,
  },
  {
    name: "Quad8",
    shape: QUAD8_SHAPE,
    nodes: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0, 0.2, 1, 0.5, 0.1, 0.5, 1, 0.2, 0, 0.5, 0.1],
    triangles: 6,
  },
] as const;

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

function heterogeneousModel(): ElementModel {
  const nodes: number[] = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0, 0, 0, 2, 1, 0, 2, 0, 1, 2, 0, 0,
    3, 2, 0, 2, 3, 0, 2, 3, 1, 2, 2, 1, 2, 2, 0, 3, 3, 0, 3, 3, 1, 3, 2, 1, 3, 4, 0, 0, 5, 0, 0, 6,
    0, 0,
  ];
  return createElementModel(nodes, [
    createElement(1, TRIANGLE_SHAPE, [0, 1, 2]),
    createElement(2, QUAD_SHAPE, [3, 4, 5, 6]),
    createElement(3, TET4_SHAPE, [7, 8, 9, 10]),
    createElement(4, HEX8_SHAPE, [11, 12, 13, 14, 15, 16, 17, 18]),
    createElement(5, LINE_SHAPE, [19, 20]),
    createElement(6, POINT_SHAPE, [21]),
  ]);
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

function geometryFor(
  model: ElementModel,
  group: "triangle",
  options?: GeometryOptions,
): TestGeometry<TriangleGeometry>;
function geometryFor(
  model: ElementModel,
  group: "line",
  options?: GeometryOptions,
): TestGeometry<LineGeometry>;
function geometryFor(
  model: ElementModel,
  group: "point",
  options?: GeometryOptions,
): TestGeometry<PointGeometry>;
function geometryFor(
  model: ElementModel,
  group: "triangle" | "line" | "point",
  options: GeometryOptions = {},
): TestGeometry<TriangleGeometry | LineGeometry | PointGeometry> {
  const authoredModel =
    options.bodies === undefined
      ? model
      : createElementModel([...model.nodes], model.elements, { bodies: options.bodies });
  const part = elementPart(
    20,
    authoredModel,
    options.faceSubset === undefined ? {} : { faceSubset: options.faceSubset },
  );
  const geometry = part.geometries.find((candidate) =>
    group === "triangle"
      ? candidate.primitive === "triangles"
      : candidate.primitive === `${group}s`,
  );
  if (geometry === undefined) throw new Error(`Expected ${group} geometry`);
  return Object.assign(geometry, { part });
}

interface GeometryOptions extends TessellationOptions {
  readonly bodies?: readonly Body[];
}

type TestGeometry<T extends TriangleGeometry | LineGeometry | PointGeometry> = T & {
  readonly part: Part;
};

function familyModel(model: ElementModel, family: ElementFamily): ElementModel {
  return createElementModel(
    [...model.nodes],
    model.elements.filter((element) => element.shape.family === family),
  );
}

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
        shape: TRIANGLE_SHAPE,
      },
    ]);
    expect(quad.part.elements).toEqual([
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
        shape: QUAD_SHAPE,
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

  it("retains the shared face between two tets for GPU visibility", () => {
    const model = sharedTetPairModel();
    const geometry = geometryFor(model, "triangle");
    expect(geometry.indices.length).toBe(8 * 3);
    expect(geometry.positions.length / 3).toBe(5);
  });

  it("retains both oriented cross-body interface faces", () => {
    const geometry = geometryFor(sharedTetPairModel(), "triangle", {
      bodies: [
        { id: 1, elementIds: [1] },
        { id: 2, elementIds: [2] },
      ],
    });
    const interfaces = (geometry.faces ?? []).filter((face) => face.neighborElementIds.length > 0);
    expect(interfaces).toHaveLength(2);
    expect(interfaces.map((face) => [face.bodyId, face.neighborElementIds])).toEqual([
      [1, [2]],
      [2, [1]],
    ]);
    expect(geometry.indices.length).toBe(8 * 3);
  });

  it("retains same-body and named/unowned interfaces for GPU visibility", () => {
    const model = sharedTetPairModel();
    const sameBody = geometryFor(model, "triangle", {
      bodies: [{ id: 1, elementIds: [1, 2] }],
    });
    expect(sameBody.indices.length).toBe(8 * 3);
    expect(sameBody.faces?.some((face) => face.neighborElementIds.length > 0)).toBe(true);

    const namedAndUnowned = geometryFor(model, "triangle", {
      bodies: [{ id: 1, elementIds: [1] }],
    });
    expect(namedAndUnowned.indices.length).toBe(8 * 3);
    expect(namedAndUnowned.faces?.some((face) => face.neighborElementIds.length > 0)).toBe(true);
  });

  it("records element tessellations so every triangle is element-pickable", () => {
    const hex = geometryFor(hex8Model(), "triangle");
    expect(hex.part.elements).toEqual([
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 12 }],
        shape: HEX8_SHAPE,
      },
    ]);
    expect(() => {
      validateElements(hex, hex.part.elements);
    }).not.toThrow();

    const solid = geometryFor(sharedTetPairModel(), "triangle");
    expect(solid.part.elements).toEqual([
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 4 }],
        shape: TET4_SHAPE,
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 4, primitiveCount: 4 }],
        shape: TET4_SHAPE,
      },
    ]);
  });

  it("records per-vertex node pick ids and node positions", () => {
    const geometry = geometryFor(tet4Model(), "triangle");
    expect(geometry.part.nodePositions).toEqual(new Float32Array(TET_NODES));
    expect(geometry.nodePickIds?.length).toBe(geometry.positions.length / 3);
    const pickIds = geometry.nodePickIds;
    if (pickIds === undefined) throw new Error("expected node pick ids");
    expect(new Set(pickIds)).toEqual(new Set([1, 2, 3, 4]));
    expect(pickIds).not.toContain(0);
  });

  it("keeps Hex20 deformation attached to every authored tessellation vertex", () => {
    const geometry = geometryFor(hex20Model(), "triangle");
    const pickIds = geometry.nodePickIds;
    if (pickIds === undefined) throw new Error("expected node pick ids");
    const values = new Float32Array(20 * 3);
    for (let node = 0; node < 20; node += 1) {
      values[node * 3] = node / 10;
      values[node * 3 + 1] = node / 20;
      values[node * 3 + 2] = -node / 30;
    }
    const field = createResultField({
      id: "hex20-displacement",
      name: "Hex20 displacement",
      location: "nodal",
      shape: "vector",
      count: 20,
      unit: "mm",
      values,
    });
    const translation = createResultField({
      id: "hex20-translation",
      name: "Hex20 translation",
      location: "nodal",
      shape: "vector",
      count: 20,
      unit: "mm",
      values: new Float32Array(20 * 3).fill(0.25),
    });
    const translated = deformGeometry(geometry, translation);
    for (let offset = 0; offset < translated.positions.length; offset += 3) {
      expect(translated.positions[offset]).toBeCloseTo((geometry.positions[offset] ?? 0) + 0.25);
      expect(translated.positions[offset + 1]).toBeCloseTo(
        (geometry.positions[offset + 1] ?? 0) + 0.25,
      );
      expect(translated.positions[offset + 2]).toBeCloseTo(
        (geometry.positions[offset + 2] ?? 0) + 0.25,
      );
    }
    const deformed = deformGeometry(geometry, field);
    for (let vertex = 0; vertex < pickIds.length; vertex += 1) {
      const node = (pickIds[vertex] ?? 1) - 1;
      const base = vertex * 3;
      expect(deformed.positions[base]).toBeCloseTo(
        (geometry.positions[base] ?? 0) + (values[node * 3] ?? 0),
      );
      expect(deformed.positions[base + 1]).toBeCloseTo(
        (geometry.positions[base + 1] ?? 0) + (values[node * 3 + 1] ?? 0),
      );
      expect(deformed.positions[base + 2]).toBeCloseTo(
        (geometry.positions[base + 2] ?? 0) + (values[node * 3 + 2] ?? 0),
      );
    }
    expect(deformGeometry(geometry, field, 0).positions).toEqual(geometry.positions);
  });

  it("records exact face ranges, descriptors, and neighbors", () => {
    const solid = geometryFor(sharedTetPairModel(), "triangle");
    expect(solid.faces).toHaveLength(8);
    solid.faces?.forEach((face) => {
      expect(face.primitiveCount).toBeGreaterThan(0);
      expect(face.nodeIds.length).toBeGreaterThanOrEqual(3);
      expect(face.key).toBeDefined();
    });
    expect(() => {
      validatePickIds(solid, solid.part.elements, solid.part.nodePositions);
    }).not.toThrow();
  });

  it("retains interior face metadata in solid geometry", () => {
    const solid = geometryFor(sharedTetPairModel(), "triangle");
    expect(solid.faces?.some((face) => face.neighborElementIds.length > 0)).toBe(true);
  });

  it("keeps full geometry while drawing an explicit stable face subset", () => {
    const geometry = geometryFor(sharedTetPairModel(), "triangle", {
      faceSubset: [{ elementId: 1, faceIndex: 3 }],
    });
    expect(geometry.indices.length).toBe(8 * 3);
    expect(geometry.faceSubset).toEqual({ faceIds: [{ elementId: 1, faceIndex: 3 }] });
    expect(geometry.faces).toHaveLength(8);
    expect(geometry.faces?.[3]).toMatchObject({
      elementId: 1,
      faceIndex: 3,
      neighborElementIds: [2],
    });
  });

  it("accepts an empty face subset and rejects unresolved identities", () => {
    const empty = geometryFor(sharedTetPairModel(), "triangle", { faceSubset: [] });
    expect(empty.faceSubset).toEqual({ faceIds: [] });
    expect(() =>
      geometryFor(sharedTetPairModel(), "triangle", {
        faceSubset: [{ elementId: 1, faceIndex: 8 }],
      }),
    ).toThrow(FaceSelectionError);
    expect(() =>
      geometryFor(sharedTetPairModel(), "triangle", {
        faceSubset: [{ elementId: 99, faceIndex: 0 }],
      }),
    ).toThrow(/outside heterogeneous elements/);
    expect(() =>
      geometryFor(sharedTetPairModel(), "triangle", {
        faceSubset: [
          { elementId: 1, faceIndex: 0 },
          { elementId: 1, faceIndex: 0 },
        ],
      }),
    ).toThrow(/repeats element 1 face 0/);
  });

  it("derives stable exterior identities from face classification", () => {
    const elements = sharedTetPairModel().elements;
    const refs = boundaryFaceRefs(elements);
    expect(refs).toHaveLength(6);
    expect(refs).not.toContainEqual({ elementId: 1, faceIndex: 3 });
    expect(refs).not.toContainEqual({ elementId: 2, faceIndex: 3 });
  });

  it("generates point sprites for point elements", () => {
    const geometry = geometryFor(pointLineModel(), "point");
    expect(geometry.primitive).toBe("points");
    expect(geometry.positions.length / 3).toBe(2);
    expect(geometry.indices.length).toBe(2);
    expect(containsPosition(geometry, [1, 2, 3])).toBe(true);
    expect(containsPosition(geometry, [4, 5, 6])).toBe(true);
    expect(Array.from(geometry.nodePickIds ?? [])).toEqual([1, 2]);
  });

  it("generates line segments for line elements", () => {
    const geometry = geometryFor(pointLineModel(), "line");
    expect(geometry.primitive).toBe("lines");
    expect(geometry.indices.length).toBe(2 + 2 * 2);
    expect(containsPosition(geometry, [1, 2, 3])).toBe(true);
    expect(containsPosition(geometry, [7, 8, 9])).toBe(true);
    expect(Array.from(geometry.nodePickIds ?? [])).toEqual([1, 2, 2, 1, 3]);
  });

  it("produces deterministic output on repeated calls", () => {
    const first = geometryFor(tet10Model(), "triangle");
    const second = geometryFor(tet10Model(), "triangle");
    expect(first.positions).toEqual(second.positions);
    expect(first.indices).toEqual(second.indices);
  });
});

describe("elementPart metadata", () => {
  it("preserves body membership through typed volume tessellation", () => {
    const geometry = geometryFor(tet4Model(), "triangle", {
      bodies: [{ id: 3, name: "housing", elementIds: [1] }],
    });
    expect(geometry.part.bodies).toEqual([{ id: 3, name: "housing", elementIds: [1] }]);
    expect(geometry.part.elements?.[0]).toMatchObject({ id: 1, bodyId: 3 });
    expect(geometry.faces?.every((face) => face.bodyId === 3)).toBe(true);
  });

  it("derives block and flattened body metadata for every primitive group", () => {
    const source = heterogeneousModel();
    const model = createElementModel([...source.nodes], source.elements, {
      blocks: [
        { id: 10, name: "surface and line", elementIds: [1, 5] },
        { id: 11, elementIds: [2, 3, 4, 6] },
      ],
      bodies: [{ id: 20, name: "assembly body", blockIds: [10, 11] }],
    });
    const part = elementPart(20, model);
    expect(part.blocks).toEqual([
      { id: 10, name: "surface and line", elementIds: [1, 5] },
      { id: 11, elementIds: [2, 3, 4, 6] },
    ]);
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

function triangleCenter(triangle: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const [a, b, c] = triangle;
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}
