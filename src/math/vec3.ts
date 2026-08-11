/** A readonly three-component vector shared by the math and geometry layers. */
export type Vec3 = readonly [number, number, number];

/** Component-wise vector addition. */
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Component-wise vector subtraction. */
export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Multiplies every vector component by a scalar. */
export function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

/** Vector cross product `a × b`. */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Vector dot product `a · b`. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Euclidean vector magnitude. */
export function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/** Returns a normalized vector, using the fallback below the supplied threshold. */
export function normalize(vector: Vec3, fallback: Vec3 = [0, 0, 1], minimumMagnitude = 0): Vec3 {
  const magnitude = length(vector);
  return !Number.isFinite(magnitude) || magnitude <= minimumMagnitude
    ? fallback
    : scale(vector, 1 / magnitude);
}

/** Component-wise centroid of the supplied points. */
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
