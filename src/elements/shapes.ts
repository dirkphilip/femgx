/**
 * Canonical finite-element topology data.
 *
 * Element shapes are identified by a family plus an interpolation order, so the
 * element kind is explicit and never inferred from raw triangles. The node
 * ordering for each supported shape follows the VTK convention: corners first,
 * then mid-edge nodes in canonical edge order. This module is pure CPU-side
 * data with no dependency on the renderer or WebGPU.
 *
 * The topology registry is compiler-exhaustive: `SupportedOrder` declares the
 * interpolation orders each family supports, the registry is checked against
 * the resulting key space with a `satisfies` constraint, and lookups still fail
 * loudly at runtime for anything untyped. Adding a family to {@link
 * ElementFamily} without declaring its orders and registering every shape fails
 * at compile time, so a topology cannot be missed or mis-keyed silently.
 */

/** A family of finite elements with a shared geometric structure. */
export type ElementFamily = "point" | "line" | "tet" | "hex";

/** Interpolation order: 0 for points, 1 linear, 2 quadratic. */
export type ElementOrder = 0 | 1 | 2;

/** An element shape: a family plus an explicit interpolation order. */
export interface ElementShape {
  readonly family: ElementFamily;
  readonly order: ElementOrder;
}

/** Point element: a single node. */
export const POINT_SHAPE: ElementShape = { family: "point", order: 0 };
/** Linear line element: two corner nodes. */
export const LINE_SHAPE: ElementShape = { family: "line", order: 1 };
/** Quadratic line element: two corners plus one mid-edge node. */
export const LINE3_SHAPE: ElementShape = { family: "line", order: 2 };
/** Linear tetrahedron (Tet4): four corner nodes. */
export const TET4_SHAPE: ElementShape = { family: "tet", order: 1 };
/** Quadratic tetrahedron (Tet10): four corners plus six mid-edge nodes. */
export const TET10_SHAPE: ElementShape = { family: "tet", order: 2 };
/** Linear hexahedron (Hex8): eight corner nodes. */
export const HEX8_SHAPE: ElementShape = { family: "hex", order: 1 };
/** Quadratic hexahedron (Hex20): eight corners plus twelve mid-edge nodes. */
export const HEX20_SHAPE: ElementShape = { family: "hex", order: 2 };

/**
 * Canonical node ordering for an element shape.
 *
 * `corners` and `edgeNodes` are indices into an element's connectivity array:
 * position `corners[i]` is the i-th geometric corner and `edgeNodes[k]` is the
 * mid-edge node on `edges[k]`. For shapes without mid-edge nodes, `edgeNodes`
 * is empty; for point elements, `edges` is empty too.
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

const TET_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 0],
  [0, 3],
  [1, 3],
  [2, 3],
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

/** The interpolation order(s) each family supports. */
type SupportedOrder = {
  point: 0;
  line: 1 | 2;
  tet: 1 | 2;
  hex: 1 | 2;
};

/** Flat key for one supported shape, e.g. `"tet:2"`. */
type ShapeKeyOf<F extends ElementFamily> = `${F}:${SupportedOrder[F]}`;

/** Union of the flat keys of every supported shape. */
type SupportedShapeKey = { [F in ElementFamily]: ShapeKeyOf<F> }[ElementFamily];

/**
 * Compile-time-exhaustive topology registry.
 *
 * The `satisfies` constraint ties the keys to `SupportedShapeKey` (derived from
 * `ElementFamily` and `SUPPORTED_ORDERS`), so a missing or mis-keyed topology
 * fails the build instead of surfacing only at runtime.
 */
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
} satisfies Record<SupportedShapeKey, ElementTopology>;

/** Runtime lookup map so unsupported shapes still fail loudly in `topologyFor`. */
const TOPOLOGIES: ReadonlyMap<string, ElementTopology> = new Map(Object.entries(TOPOLOGY_REGISTRY));

/** Looks up the canonical topology for a shape, throwing if the shape is unsupported. */
export function topologyFor(shape: ElementShape): ElementTopology {
  const topology = TOPOLOGIES.get(`${shape.family}:${shape.order}`);
  if (topology === undefined) {
    throw new Error(`Unsupported element shape ${shape.family} order ${shape.order}`);
  }
  return topology;
}
