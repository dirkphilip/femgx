import type { ElementShape } from "../../../src/elements/shapes";

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
 * canonical convention used by `topologyFor`: corners first, then mid-edge
 * nodes in canonical edge order. `faces` and `edgeSequences` are the expected
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
