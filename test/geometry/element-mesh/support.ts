import { createElement } from "../../../src/elements/element";

import { createElementModel, type Body, type ElementModel } from "../../../src/elements/model";

import { boundaryFaceRefs, FaceSelectionError } from "../../../src/elements/faces";

import { ElementShape, topologyFor, type ElementFamily } from "../../../src/elements/shapes";

import { type CreatePartFromElementModelOptions, createPartFromElementModel } from "../../../src/geometry/element-model-part";

import {
  validateElements,
  validatePickIds,
  type LineGeometry,
  type Part,
  type PointGeometry,
  type TriangleGeometry,
} from "../../../src/geometry/part";

import { deformGeometry } from "../../../src/results/deform";

import { createResultField } from "../../../src/results/fields";

export type Vec3 = readonly [number, number, number];

export const TET_NODES: readonly number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Shared core test helper. */
export function tet4Model(): ElementModel {
  return createElementModel(TET_NODES, [createElement(1, ElementShape.Tet4, [0, 1, 2, 3])]);
}

export const TET10_NODES: readonly number[] = [
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

/** Shared core test helper. */
export function tet10Model(): ElementModel {
  const nodeIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return createElementModel(TET10_NODES, [createElement(1, ElementShape.Tet10, nodeIds)]);
}

export const HEX8_NODES: readonly number[] = [
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

/** Shared core test helper. */
export function hex8Model(): ElementModel {
  return createElementModel(HEX8_NODES, [
    createElement(1, ElementShape.Hex8, [0, 1, 2, 3, 4, 5, 6, 7]),
  ]);
}

/** Shared core test helper. */
export function wedge6Model(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1],
    [createElement(1, ElementShape.Wedge6, [0, 1, 2, 3, 4, 5])],
  );
}

/** Shared core test helper. */
export function pyramid5Model(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0.5, 1],
    [createElement(1, ElementShape.Pyramid5, [0, 1, 2, 3, 4])],
  );
}

/** Shared core test helper. */
export function hex20Model(): ElementModel {
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
      ElementShape.Hex20,
      Array.from({ length: 20 }, (_, index) => index),
    ),
  ]);
}

/** Shared core test helper. */
export function skewedHex20Model(): ElementModel {
  const model = hex20Model();
  const nodes: number[] = [];
  for (let offset = 0; offset < model.nodes.length; offset += 3) {
    const x = model.nodes[offset] ?? 0;
    const y = model.nodes[offset + 1] ?? 0;
    const z = model.nodes[offset + 2] ?? 0;
    nodes.push(x + 0.2 * y, y + 0.15 * z, z + 0.1 * x);
  }
  return createElementModel(nodes, [...model.elements]);
}

/** Shared core test helper. */
export function surfaceModel(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0],
    [
      createElement(1, ElementShape.Triangle, [0, 1, 2]),
      createElement(2, ElementShape.Quad, [1, 3, 4, 2]),
    ],
  );
}

export const QUADRATIC_SURFACES = [
  {
    name: "Tri6",
    shape: ElementShape.Tri6,
    nodes: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0, 0.2, 0.5, 0.5, 0.1, 0, 0.5, 0.2],
    triangles: 4,
  },
  {
    name: "Quad8",
    shape: ElementShape.Quad8,
    nodes: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0, 0.2, 1, 0.5, 0.1, 0.5, 1, 0.2, 0, 0.5, 0.1],
    triangles: 6,
  },
] as const;

/** Shared core test helper. */
export function sharedTetPairModel(): ElementModel {
  const nodes = [...TET_NODES, 0, 0, -1];
  return createElementModel(nodes, [
    createElement(1, ElementShape.Tet4, [0, 1, 2, 3]),
    createElement(2, ElementShape.Tet4, [0, 1, 2, 4]),
  ]);
}

/** Shared core test helper. */
export function pointLineModel(): ElementModel {
  return createElementModel(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [
      createElement(1, ElementShape.Point, [0]),
      createElement(2, ElementShape.Point, [1]),
      createElement(3, ElementShape.Line, [0, 1]),
      createElement(4, ElementShape.Line3, [1, 2, 0]),
    ],
  );
}

/** Shared core test helper. */
export function heterogeneousModel(): ElementModel {
  const nodes: number[] = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0, 0, 0, 2, 1, 0, 2, 0, 1, 2, 0, 0,
    3, 2, 0, 2, 3, 0, 2, 3, 1, 2, 2, 1, 2, 2, 0, 3, 3, 0, 3, 3, 1, 3, 2, 1, 3, 4, 0, 0, 5, 0, 0, 6,
    0, 0,
  ];
  return createElementModel(nodes, [
    createElement(1, ElementShape.Triangle, [0, 1, 2]),
    createElement(2, ElementShape.Quad, [3, 4, 5, 6]),
    createElement(3, ElementShape.Tet4, [7, 8, 9, 10]),
    createElement(4, ElementShape.Hex8, [11, 12, 13, 14, 15, 16, 17, 18]),
    createElement(5, ElementShape.Line, [19, 20]),
    createElement(6, ElementShape.Point, [21]),
  ]);
}

/** Shared core test helper. */
export function triangles(geometry: {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}) {
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

/** Shared core test helper. */
export function triangleNormal(triangle: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const [a, b, c] = triangle;
  return cross(subtract(b, a), subtract(c, a));
}

/** Shared core test helper. */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Shared core test helper. */
export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Shared core test helper. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Shared core test helper. */
export function containsPosition(
  geometry: { readonly positions: Float32Array },
  point: Vec3,
): boolean {
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

/** Shared core test helper. */
export function geometryFor(
  model: ElementModel,
  group: "triangle",
  options?: GeometryOptions,
): TestGeometry<TriangleGeometry>;

/** Shared core test helper. */
export function geometryFor(
  model: ElementModel,
  group: "line",
  options?: GeometryOptions,
): TestGeometry<LineGeometry>;

/** Shared core test helper. */
export function geometryFor(
  model: ElementModel,
  group: "point",
  options?: GeometryOptions,
): TestGeometry<PointGeometry>;

/** Shared core test helper. */
export function geometryFor(
  model: ElementModel,
  group: "triangle" | "line" | "point",
  options: GeometryOptions = {},
): TestGeometry<TriangleGeometry | LineGeometry | PointGeometry> {
  const authoredModel =
    options.bodies === undefined
      ? model
      : createElementModel([...model.nodes], [...model.elements], { bodies: options.bodies });
  const part = createPartFromElementModel(
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

export interface GeometryOptions extends CreatePartFromElementModelOptions {
  readonly bodies?: readonly Body[];
}

export type TestGeometry<T extends TriangleGeometry | LineGeometry | PointGeometry> = T & {
  readonly part: Part;
};

/** Shared core test helper. */
export function familyModel(model: ElementModel, family: ElementFamily): ElementModel {
  return createElementModel(
    [...model.nodes],
    [...model.elements].filter((element) => topologyFor(element.shape).family === family),
  );
}

/** Shared core test helper. */
export function triangleCenter(triangle: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const [a, b, c] = triangle;
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

export {
  createElement,
  createElementModel,
  type Body,
  type ElementModel,
  boundaryFaceRefs,
  FaceSelectionError,
  ElementShape,
  topologyFor,
  type ElementFamily,
  type CreatePartFromElementModelOptions,
  createPartFromElementModel,
  validateElements,
  validatePickIds,
  type LineGeometry,
  type Part,
  type PointGeometry,
  type TriangleGeometry,
  deformGeometry,
  createResultField,
};
