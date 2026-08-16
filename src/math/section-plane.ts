/**
 * A single world-space plane used to keep the positive half-space visible.
 * @category Viewport lifecycle
 */
export interface SectionPlane {
  /** Finite plane normal. It is normalized before the plane is stored. */
  readonly normal: readonly [number, number, number];
  /** Signed plane distance in `dot(normal, position) + distance = 0`. */
  readonly distance: number;
}

/** Returns a validated, unit-normal section plane for viewport state. */
export function normalizeSectionPlane(plane: SectionPlane): SectionPlane {
  const candidate: unknown = plane;
  const normal =
    typeof candidate === "object" && candidate !== null && "normal" in candidate
      ? candidate.normal
      : undefined;
  const distance =
    typeof candidate === "object" && candidate !== null && "distance" in candidate
      ? candidate.distance
      : undefined;
  if (!Array.isArray(normal) || normal.length !== 3) {
    throw new RangeError("Section plane normal must contain exactly three components");
  }
  const x: unknown = normal[0];
  const y: unknown = normal[1];
  const z: unknown = normal[2];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
    throw new RangeError("Section plane normal components must be numbers");
  }
  if (typeof distance !== "number") {
    throw new RangeError("Section plane distance must be a number");
  }
  const length = Math.hypot(x, y, z);
  if (![x, y, z, distance].every(Number.isFinite) || length <= Number.EPSILON) {
    throw new RangeError("Section plane normal must be finite and non-zero, with finite distance");
  }
  return {
    normal: [x / length, y / length, z / length],
    distance: distance / length,
  };
}
