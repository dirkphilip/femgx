import type { Vec3 } from "./vec3";

/**
 * 4x4 column-major matrix stored as a 16-element Float32Array.
 * @category Camera and math
 */
export type Mat4 = Float32Array;

/** Returns the cell at (row, column) with bounds-safe access. */
function cell(m: Float32Array, row: number, column: number): number {
  return m[column * 4 + row] ?? 0;
}

/** Sets the cell at (row, column). */
function setCell(m: Float32Array, row: number, column: number, value: number): void {
  m[column * 4 + row] = value;
}

/**
 * Creates a fresh identity matrix.
 * @category Camera and math
 */
export function identity(): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/**
 * Creates a translation matrix from x, y, z components.
 * @category Camera and math
 */
export function translation(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

/**
 * Creates a uniform or non-uniform scale matrix.
 * @category Camera and math
 */
export function scale(x: number, y = x, z = x): Mat4 {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}

/**
 * Creates a rotation matrix around the z axis.
 * @category Camera and math
 */
export function rotationZ(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/**
 * Transforms a point by a matrix, including its homogeneous divide.
 * @category Camera and math
 */
export function transformPoint(
  matrix: Mat4,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] {
  const [transformedX, transformedY, transformedZ, w] = transformPoint4(matrix, x, y, z);
  const divisor = w === 0 ? 1 : w;
  return [transformedX / divisor, transformedY / divisor, transformedZ / divisor];
}

/** Transforms a point by a column-major matrix without dividing by `w`. */
export function transformPoint4(
  matrix: Mat4,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number, number] {
  return [
    cell(matrix, 0, 0) * x + cell(matrix, 0, 1) * y + cell(matrix, 0, 2) * z + cell(matrix, 0, 3),
    cell(matrix, 1, 0) * x + cell(matrix, 1, 1) * y + cell(matrix, 1, 2) * z + cell(matrix, 1, 3),
    cell(matrix, 2, 0) * x + cell(matrix, 2, 1) * y + cell(matrix, 2, 2) * z + cell(matrix, 2, 3),
    cell(matrix, 3, 0) * x + cell(matrix, 3, 1) * y + cell(matrix, 3, 2) * z + cell(matrix, 3, 3),
  ];
}

/** Applies only the rotational 3×3 portion of a matrix to a direction. */
export function transformDirection(matrix: Mat4, direction: Vec3): Vec3 {
  return [
    cell(matrix, 0, 0) * direction[0] +
      cell(matrix, 0, 1) * direction[1] +
      cell(matrix, 0, 2) * direction[2],
    cell(matrix, 1, 0) * direction[0] +
      cell(matrix, 1, 1) * direction[1] +
      cell(matrix, 1, 2) * direction[2],
    cell(matrix, 2, 0) * direction[0] +
      cell(matrix, 2, 1) * direction[1] +
      cell(matrix, 2, 2) * direction[2],
  ];
}

/**
 * Multiplies two matrices and returns a new matrix (a * b).
 * @category Camera and math
 */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += cell(a, row, k) * cell(b, k, column);
      }
      setCell(out, row, column, sum);
    }
  }
  return out;
}
