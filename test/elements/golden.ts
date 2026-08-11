import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  type ElementShape,
} from "../../src/elements/shapes";

/**
 * Golden element conventions: the canonical node ordering, reference geometry,
 * and expected face/edge output for every standard element shape.
 *
 * This is the single documented reference for the "standard element
 * conventions" this library commits to. It is the source of truth that
 * `test/elements/golden.test.ts` validates the implementation against, so a
 * topology or extraction regression fails with the affected element type
 * named in the test case.
 *
 * ## Units
 *
 * All `reference` coordinates are in **meters** and describe the conventional
 * unit element in a right-handed frame:
 *
 * - a line spans `1 m` along X from the origin;
 * - a Tet4/Tet10 sits on the three unit axes (`(0,0,0)`, `(1,0,0)`,
 *   `(0,1,0)`, `(0,0,1)`) with volume `1/6 m^3`;
 * - a Hex8/Hex20 is the unit cube `[0,1]^3` with volume `1 m^3`.
 *
 * Quadratic shapes place every mid-edge node exactly at the midpoint of its
 * edge's two corner nodes, which is the interpolation convention the golden
 * tests verify numerically.
 *
 * ## Node ordering
 *
 * `corners`/`edges`/`edgeNodes` are connectivity-position indices matching the
 * VTK convention used by `topologyFor`: corners first, then mid-edge nodes in
 * canonical edge order. `faces` and `edgeSequences` are the expected
 * `facesOf`/`edgesOf` output for a sequential element (`nodeIds = 0..n-1`).
 */

export interface GoldenBounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface GoldenElementConvention {
  /** Stable, human-readable element name, e.g. `"tet4"`. */
  readonly name: string;
  readonly shape: ElementShape;
  readonly nodeCount: number;
  /** Connectivity positions of the corners, in canonical order. */
  readonly corners: readonly number[];
  /** Edges as pairs of corner connectivity positions. */
  readonly edges: ReadonlyArray<readonly [number, number]>;
  /** Connectivity positions of the mid-edge nodes, aligned with `edges`. */
  readonly edgeNodes: readonly number[];
  /**
   * Reference coordinates (meters) for each connectivity position, in the
   * conventional unit element described above.
   */
  readonly reference: ReadonlyArray<readonly [number, number, number]>;
  /** Expected `facesOf` node-id loops for a sequential element. */
  readonly faces: ReadonlyArray<readonly number[]>;
  /** Expected `edgesOf` node-id sequences for a sequential element. */
  readonly edgeSequences: ReadonlyArray<readonly number[]>;
  /** Axis-aligned bounds of the reference coordinates. */
  readonly bounds: GoldenBounds;
  /** Signed volume of the reference element (`0` for point/line shapes). */
  readonly volume: number;
}

export const GOLDEN_ELEMENT_CONVENTIONS: readonly GoldenElementConvention[] = [
  {
    name: "point",
    shape: POINT_SHAPE,
    nodeCount: 1,
    corners: [0],
    edges: [],
    edgeNodes: [],
    reference: [[0, 0, 0]],
    faces: [],
    edgeSequences: [],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
    volume: 0,
  },
  {
    name: "line",
    shape: LINE_SHAPE,
    nodeCount: 2,
    corners: [0, 1],
    edges: [[0, 1]],
    edgeNodes: [],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    faces: [],
    edgeSequences: [[0, 1]],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0, maxZ: 0 },
    volume: 0,
  },
  {
    name: "line3",
    shape: LINE3_SHAPE,
    nodeCount: 3,
    corners: [0, 1],
    edges: [[0, 1]],
    edgeNodes: [2],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [0.5, 0, 0],
    ],
    faces: [],
    edgeSequences: [[0, 2, 1]],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0, maxZ: 0 },
    volume: 0,
  },
  {
    name: "triangle",
    shape: TRIANGLE_SHAPE,
    nodeCount: 3,
    corners: [0, 1, 2],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
    edgeNodes: [],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    faces: [[0, 1, 2]],
    edgeSequences: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 },
    volume: 0,
  },
  {
    name: "quad",
    shape: QUAD_SHAPE,
    nodeCount: 4,
    corners: [0, 1, 2, 3],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    edgeNodes: [],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    faces: [[0, 1, 2, 3]],
    edgeSequences: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 },
    volume: 0,
  },
  {
    name: "tet4",
    shape: TET4_SHAPE,
    nodeCount: 4,
    corners: [0, 1, 2, 3],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 3],
      [1, 3],
      [2, 3],
    ],
    edgeNodes: [],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    faces: [
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
      [0, 2, 1],
    ],
    edgeSequences: [
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 3],
      [1, 3],
      [2, 3],
    ],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    volume: 1 / 6,
  },
  {
    name: "tet10",
    shape: TET10_SHAPE,
    nodeCount: 10,
    corners: [0, 1, 2, 3],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 3],
      [1, 3],
      [2, 3],
    ],
    edgeNodes: [4, 5, 6, 7, 8, 9],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0, 0],
      [0.5, 0.5, 0],
      [0, 0.5, 0],
      [0, 0, 0.5],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ],
    faces: [
      [0, 4, 1, 8, 3, 7],
      [1, 5, 2, 9, 3, 8],
      [2, 6, 0, 7, 3, 9],
      [0, 6, 2, 5, 1, 4],
    ],
    edgeSequences: [
      [0, 4, 1],
      [1, 5, 2],
      [2, 6, 0],
      [0, 7, 3],
      [1, 8, 3],
      [2, 9, 3],
    ],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    volume: 1 / 6,
  },
  {
    name: "hex8",
    shape: HEX8_SHAPE,
    nodeCount: 8,
    corners: [0, 1, 2, 3, 4, 5, 6, 7],
    edges: [
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
    ],
    edgeNodes: [],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    faces: [
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
      [0, 3, 2, 1],
      [4, 5, 6, 7],
    ],
    edgeSequences: [
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
    ],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    volume: 1,
  },
  {
    name: "hex20",
    shape: HEX20_SHAPE,
    nodeCount: 20,
    corners: [0, 1, 2, 3, 4, 5, 6, 7],
    edges: [
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
    ],
    edgeNodes: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
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
    ],
    faces: [
      [0, 16, 4, 15, 7, 19, 3, 11],
      [1, 9, 2, 18, 6, 13, 5, 17],
      [0, 8, 1, 17, 5, 12, 4, 16],
      [3, 19, 7, 14, 6, 18, 2, 10],
      [0, 11, 3, 10, 2, 9, 1, 8],
      [4, 12, 5, 13, 6, 14, 7, 15],
    ],
    edgeSequences: [
      [0, 8, 1],
      [1, 9, 2],
      [2, 10, 3],
      [3, 11, 0],
      [4, 12, 5],
      [5, 13, 6],
      [6, 14, 7],
      [7, 15, 4],
      [0, 16, 4],
      [1, 17, 5],
      [2, 18, 6],
      [3, 19, 7],
    ],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    volume: 1,
  },
];
