/**
 * Canonical finite-element topology data.
 *
 * Element shapes are identified by a family plus an interpolation order, so the
 * element kind is explicit and never inferred from raw triangles. The node
 * ordering for each supported shape is canonical: corners first, then
 * mid-edge nodes in canonical edge order. This module is pure CPU-side data
 * with no dependency on the renderer or WebGPU.
 *
 * The public `ElementShape` const is the single supported-shape list. Its
 * primitive values make invalid family/order combinations unrepresentable and
 * key the compiler-exhaustive topology registry directly.
 */

/**
 * A family of finite elements with a shared geometric structure.
 * @category Elements and model editing
 */
export type ElementFamily =
  "point" | "line" | "triangle" | "quad" | "tet" | "wedge" | "pyramid" | "hex";

/**
 * Interpolation order: 0 for points, 1 linear, 2 quadratic.
 * @category Elements and model editing
 */
export type ElementOrder = 0 | 1 | 2;

/**
 * Supported finite-element shapes. Each value is a primitive discriminant;
 * family, interpolation order, node count, and canonical connectivity ordering
 * are available through {@link topologyFor}.
 * @category Elements and model editing
 */
export const ElementShape = {
  /** Point: one node. */
  Point: "point:0",
  /** Line: two corner nodes, ordered end to end. */
  Line: "line:1",
  /** Line3: two corner nodes followed by the mid-edge node. */
  Line3: "line:2",
  /** Triangle: three corner nodes in oriented loop order. */
  Triangle: "triangle:1",
  /** Tri6: three corners followed by the three perimeter mid-edge nodes. */
  Tri6: "triangle:2",
  /** Quad: four corner nodes in oriented loop order. */
  Quad: "quad:1",
  /** Quad8: four corners followed by the four perimeter mid-edge nodes. */
  Quad8: "quad:2",
  /** Tet4: four corner nodes in the canonical tetrahedron order. */
  Tet4: "tet:1",
  /** Tet10: four corners followed by six canonical edge nodes. */
  Tet10: "tet:2",
  /** Wedge6: three lower corners followed by three upper corners. */
  Wedge6: "wedge:1",
  /** Pyramid5: four base corners followed by the apex. */
  Pyramid5: "pyramid:1",
  /** Hex8: four lower corners followed by four upper corners. */
  Hex8: "hex:1",
  /** Hex20: eight corners followed by twelve canonical edge nodes. */
  Hex20: "hex:2",
} as const;

/** One of the finite-element shapes supported by {@link ElementShape}. */
export type ElementShape = (typeof ElementShape)[keyof typeof ElementShape];

/**
 * Canonical node ordering for an element shape.
 *
 * `corners` and `edgeNodes` are indices into an element's connectivity array:
 * position `corners[i]` is the i-th geometric corner and `edgeNodes[k]` is the
 * mid-edge node on `edges[k]`. For shapes without mid-edge nodes, `edgeNodes`
 * is empty; for point elements, `edges` is empty too.
 * @category Elements and model editing
 */
export interface ElementTopology {
  readonly family: ElementFamily;
  readonly order: ElementOrder;
  /** Number of nodes an element of this shape references. */
  readonly nodeCount: number;
  /** Connectivity indices of the corners, in canonical order. */
  readonly corners: readonly number[];
  /** Edges as pairs of corner indices; `edgeNodes[k]` lies on `edges[k]`. */
  readonly edges: ReadonlyArray<readonly [number, number]>;
  /** Connectivity indices of the mid-edge nodes, aligned with `edges`. */
  readonly edgeNodes: readonly number[];
}

const TRIANGLE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 0],
];

const QUAD_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

const TET_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 0],
  [0, 3],
  [1, 3],
  [2, 3],
];

const WEDGE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 0],
  [3, 4],
  [4, 5],
  [5, 3],
  [0, 3],
  [1, 4],
  [2, 5],
];

const PYRAMID_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
];

const HEX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/** Flat key for one supported shape, e.g. `"tet:2"`. */
export type SupportedShapeKey = ElementShape;

/** The element family encoded in a shape key, e.g. `"tet"` in `"tet:2"`. */
type FamilyOf<K extends SupportedShapeKey> = K extends `${infer F}:${number}` ? F : never;

/** The interpolation order encoded in a shape key, e.g. `2` in `"tet:2"`. */
type OrderOf<K extends SupportedShapeKey> = K extends `${string}:${infer O}`
  ? O extends "0"
    ? 0
    : O extends "1"
      ? 1
      : O extends "2"
        ? 2
        : never
  : never;

/**
 * A topology entry whose `family` and `order` are pinned to the literals
 * encoded in its key, so a value copied under the wrong key fails to compile.
 */
export type KeyedTopology<K extends SupportedShapeKey> = ElementTopology & {
  family: FamilyOf<K>;
  order: OrderOf<K>;
};

/**
 * Compile-time-exhaustive topology registry.
 *
 * The `satisfies` constraint ties the keys to `SupportedShapeKey` (derived from
 * `ElementFamily` and `SupportedOrder`) and pins each entry's `family`/`order`
 * to the literals in its key, so a missing topology, a mis-keyed key, or a
 * value whose `family`/`order` contradict the key fails the build instead of
 * surfacing only at runtime.
 */
type TopologyRegistry = { [K in SupportedShapeKey]: KeyedTopology<K> };

const TOPOLOGY_REGISTRY = {
  "point:0": { family: "point", order: 0, nodeCount: 1, corners: [0], edges: [], edgeNodes: [] },
  "line:1": {
    family: "line",
    order: 1,
    nodeCount: 2,
    corners: [0, 1],
    edges: [[0, 1]],
    edgeNodes: [],
  },
  "line:2": {
    family: "line",
    order: 2,
    nodeCount: 3,
    corners: [0, 1],
    edges: [[0, 1]],
    edgeNodes: [2],
  },
  "triangle:1": {
    family: "triangle",
    order: 1,
    nodeCount: 3,
    corners: [0, 1, 2],
    edges: TRIANGLE_EDGES,
    edgeNodes: [],
  },
  "triangle:2": {
    family: "triangle",
    order: 2,
    nodeCount: 6,
    corners: [0, 1, 2],
    edges: TRIANGLE_EDGES,
    edgeNodes: [3, 4, 5],
  },
  "quad:1": {
    family: "quad",
    order: 1,
    nodeCount: 4,
    corners: [0, 1, 2, 3],
    edges: QUAD_EDGES,
    edgeNodes: [],
  },
  "quad:2": {
    family: "quad",
    order: 2,
    nodeCount: 8,
    corners: [0, 1, 2, 3],
    edges: QUAD_EDGES,
    edgeNodes: [4, 5, 6, 7],
  },
  "tet:1": {
    family: "tet",
    order: 1,
    nodeCount: 4,
    corners: [0, 1, 2, 3],
    edges: TET_EDGES,
    edgeNodes: [],
  },
  "tet:2": {
    family: "tet",
    order: 2,
    nodeCount: 10,
    corners: [0, 1, 2, 3],
    edges: TET_EDGES,
    edgeNodes: [4, 5, 6, 7, 8, 9],
  },
  "wedge:1": {
    family: "wedge",
    order: 1,
    nodeCount: 6,
    corners: [0, 1, 2, 3, 4, 5],
    edges: WEDGE_EDGES,
    edgeNodes: [],
  },
  "pyramid:1": {
    family: "pyramid",
    order: 1,
    nodeCount: 5,
    corners: [0, 1, 2, 3, 4],
    edges: PYRAMID_EDGES,
    edgeNodes: [],
  },
  "hex:1": {
    family: "hex",
    order: 1,
    nodeCount: 8,
    corners: [0, 1, 2, 3, 4, 5, 6, 7],
    edges: HEX_EDGES,
    edgeNodes: [],
  },
  "hex:2": {
    family: "hex",
    order: 2,
    nodeCount: 20,
    corners: [0, 1, 2, 3, 4, 5, 6, 7],
    edges: HEX_EDGES,
    edgeNodes: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  },
} satisfies TopologyRegistry;

/**
 * Looks up the canonical topology for a supported shape.
 * @category Elements and model editing
 */
export function topologyFor(shape: ElementShape): ElementTopology {
  return TOPOLOGY_REGISTRY[shape];
}
