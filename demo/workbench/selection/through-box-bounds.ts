import type { Mat4, SectionPlane, Vec3 } from "../../../src/entries/root";
import type { BoxSelectionFrustum } from "../../../src/entries/interaction";

const FRUSTUM_PLANES: readonly (keyof BoxSelectionFrustum)[] = [
  "left",
  "right",
  "top",
  "bottom",
  "near",
  "far",
];

/** One world-space clip plane transformed into part-local affine coordinates. */
export interface LocalBoundsPlane {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly constant: number;
}

/** Transforms the query planes once for repeated local-bounds classification. */
export function localBoundsPlanes(
  transform: Mat4,
  frustum: BoxSelectionFrustum,
  sectionPlane: SectionPlane | undefined,
): readonly LocalBoundsPlane[] | undefined {
  if (!isAffineTransform(transform)) return undefined;
  const planes = FRUSTUM_PLANES.map((name) => localBoundsPlane(transform, frustum[name]));
  if (sectionPlane !== undefined) planes.push(localBoundsPlane(transform, sectionPlane));
  return planes;
}

/** Returns false outside, true wholly inside, and undefined at a clip boundary. */
export function classifyLocalBounds(
  bounds: Float64Array,
  base: number,
  planes: readonly LocalBoundsPlane[],
  tolerance: number,
): boolean | undefined {
  let whollyInside = true;
  for (const plane of planes) {
    const distances = boundsDistances(bounds, base, plane);
    if (distances.max < -tolerance) return false;
    whollyInside &&= distances.min >= -tolerance;
  }
  return whollyInside ? true : undefined;
}

function isAffineTransform(transform: Mat4): boolean {
  return (
    matrixValue(transform, 3) === 0 &&
    matrixValue(transform, 7) === 0 &&
    matrixValue(transform, 11) === 0 &&
    matrixValue(transform, 15) === 1
  );
}

function localBoundsPlane(
  transform: Mat4,
  plane: { readonly normal: Vec3; readonly distance: number },
): LocalBoundsPlane {
  const [nx, ny, nz] = plane.normal;
  return {
    x:
      nx * matrixValue(transform, 0) +
      ny * matrixValue(transform, 1) +
      nz * matrixValue(transform, 2),
    y:
      nx * matrixValue(transform, 4) +
      ny * matrixValue(transform, 5) +
      nz * matrixValue(transform, 6),
    z:
      nx * matrixValue(transform, 8) +
      ny * matrixValue(transform, 9) +
      nz * matrixValue(transform, 10),
    constant:
      nx * matrixValue(transform, 12) +
      ny * matrixValue(transform, 13) +
      nz * matrixValue(transform, 14) +
      plane.distance,
  };
}

function boundsDistances(
  bounds: Float64Array,
  base: number,
  plane: LocalBoundsPlane,
): { readonly min: number; readonly max: number } {
  const minX = bounds[base] ?? Infinity;
  const minY = bounds[base + 1] ?? Infinity;
  const minZ = bounds[base + 2] ?? Infinity;
  const maxX = bounds[base + 3] ?? -Infinity;
  const maxY = bounds[base + 4] ?? -Infinity;
  const maxZ = bounds[base + 5] ?? -Infinity;
  const max =
    plane.constant +
    (plane.x >= 0 ? plane.x * maxX : plane.x * minX) +
    (plane.y >= 0 ? plane.y * maxY : plane.y * minY) +
    (plane.z >= 0 ? plane.z * maxZ : plane.z * minZ);
  const min =
    plane.constant +
    (plane.x >= 0 ? plane.x * minX : plane.x * maxX) +
    (plane.y >= 0 ? plane.y * minY : plane.y * maxY) +
    (plane.z >= 0 ? plane.z * minZ : plane.z * maxZ);
  return { min, max };
}

function matrixValue(matrix: Mat4, index: number): number {
  return matrix[index] ?? 0;
}
