import { topologyFor, type ElementShape } from "../elements/shapes";

/**
 * Gmsh MSH 2.2 lists the mid-edge nodes of quadratic elements in a different
 * order than the canonical VTK ordering (see `src/elements/shapes.ts`), so
 * gmsh connectivity must be permuted at the format boundary. Corners keep the
 * canonical order in gmsh, so only the mid-edge slots differ. `GMSH_EDGE_ORDER`
 * is the gmsh convention: the edge (as a corner-index pair) carrying the k-th
 * mid-edge node, in gmsh connectivity slot order.
 */
const GMSH_EDGE_ORDER: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>> = new Map([
  [
    "tet:2",
    [
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 3],
      [2, 3],
      [1, 3],
    ],
  ],
  [
    "hex:2",
    [
      [0, 1],
      [3, 0],
      [0, 4],
      [1, 2],
      [1, 5],
      [2, 3],
      [2, 6],
      [3, 7],
      [4, 5],
      [7, 4],
      [5, 6],
      [6, 7],
    ],
  ],
]);

/** True when the two corner-index pairs name the same geometric edge. */
function sameEdge(a: readonly [number, number], b: readonly [number, number]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/** Bounds-checked read of a trusted table, so the strict indexing settings need no non-null assertions. */
function read<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Missing item at index ${index} of ${items.length}`);
  }
  return item;
}

function inverseOf(permutation: ReadonlyArray<number>): number[] {
  const inverse = new Array<number>(permutation.length);
  for (let index = 0; index < permutation.length; index += 1) {
    inverse[read(permutation, index)] = index;
  }
  return inverse;
}

/**
 * The canonical-to-gmsh permutation for `shape`, or `undefined` when the gmsh
 * ordering already matches the canonical one. Applying it gives
 * `gmsh[i] = canonical[permutation[i]]` for every connectivity slot `i`.
 */
export function canonicalToGmshOrder(shape: ElementShape): ReadonlyArray<number> | undefined {
  const gmshEdges = GMSH_EDGE_ORDER.get(`${shape.family}:${shape.order}`);
  if (gmshEdges === undefined) {
    return undefined;
  }
  const topology = topologyFor(shape);
  const permutation = [...topology.corners];
  for (let gmshEdge = 0; gmshEdge < gmshEdges.length; gmshEdge += 1) {
    const canonicalEdge = topology.edges.findIndex((edge) =>
      sameEdge(edge, read(gmshEdges, gmshEdge)),
    );
    if (canonicalEdge === -1) {
      throw new Error(
        `Gmsh edge ${String(read(gmshEdges, gmshEdge))} is not a canonical ${shape.family} edge`,
      );
    }
    permutation[topology.corners.length + gmshEdge] = read(topology.edgeNodes, canonicalEdge);
  }
  return permutation;
}

/**
 * The gmsh-to-canonical permutation for `shape`, or `undefined` when the gmsh
 * ordering already matches the canonical one. Applying it gives
 * `canonical[i] = gmsh[permutation[i]]` for every connectivity slot `i`.
 */
export function gmshToCanonicalOrder(shape: ElementShape): ReadonlyArray<number> | undefined {
  const toGmsh = canonicalToGmshOrder(shape);
  return toGmsh === undefined ? undefined : inverseOf(toGmsh);
}

/** Returns `connectivity` reordered so `result[i] = connectivity[permutation[i]]`. */
export function permuteConnectivity(
  connectivity: readonly number[],
  permutation: ReadonlyArray<number>,
): number[] {
  const permuted = new Array<number>(connectivity.length);
  for (let index = 0; index < permutation.length; index += 1) {
    permuted[index] = read(connectivity, read(permutation, index));
  }
  return permuted;
}
