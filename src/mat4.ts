/** 4x4 column-major matrix stored as a 16-element Float32Array. */
export type Mat4 = Float32Array;

/** Returns the cell at (row, column) with bounds-safe access. */
function cell(m: Float32Array, row: number, column: number): number {
  return m[row * 4 + column] ?? 0;
}

/** Sets the cell at (row, column). */
function setCell(m: Float32Array, row: number, column: number, value: number): void {
  m[row * 4 + column] = value;
}

/** Creates a fresh identity matrix. */
export function identity(): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** Creates a translation matrix from x, y, z components. */
export function translation(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

/** Multiplies two matrices and returns a new matrix (a * b). */
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
