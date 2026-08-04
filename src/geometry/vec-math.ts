/**
 * Minimal 3D vector helpers used by mesh tessellation. Internal to the
 * geometry subsystem; not part of the public API.
 */

export type Vec3 = readonly [number, number, number];

/** Component-wise centroid of the given points. */
export function average(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
    z += point[2];
  }
  const count = Math.max(1, points.length);
  return [x / count, y / count, z / count];
}

/** Component-wise `a - b`. */
export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Vector cross product `a x b`. */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Vector dot product `a . b`. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Euclidean magnitude of the vector. */
export function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/** Quadratic Lagrange interpolation along the control points a-mid-b. */
export function quadraticPoint(a: Vec3, mid: Vec3, b: Vec3, t: number): Vec3 {
  const w0 = (1 - t) * (1 - 2 * t);
  const w1 = 4 * t * (1 - t);
  const w2 = t * (2 * t - 1);
  return [
    w0 * a[0] + w1 * mid[0] + w2 * b[0],
    w0 * a[1] + w1 * mid[1] + w2 * b[1],
    w0 * a[2] + w1 * mid[2] + w2 * b[2],
  ];
}
