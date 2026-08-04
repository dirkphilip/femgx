import type { FieldLocation } from "./fields";
import {
  FIELD_COMPONENT_COUNT,
  createResultField,
  type FieldShape,
  type ResultField,
  type Tensor6,
  type TensorField,
  type VectorField,
} from "./fields";

/** Returns the Euclidean length of a three-component vector. */
export function magnitude(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Returns the Frobenius norm of a symmetric tensor in Voigt order. */
export function tensorMagnitude(tensor: Tensor6): number {
  const [xx, yy, zz, xy, yz, zx] = tensor;
  return Math.sqrt(xx * xx + yy * yy + zz * zz + 2 * (xy * xy + yz * yz + zx * zx));
}

/**
 * Returns the von Mises equivalent stress of a symmetric stress tensor in
 * Voigt order `[xx, yy, zz, xy, yz, zx]`.
 */
export function vonMises(tensor: Tensor6): number {
  const [xx, yy, zz, xy, yz, zx] = tensor;
  const deviatoric = (xx - yy) * (xx - yy) + (yy - zz) * (yy - zz) + (zz - xx) * (zz - xx);
  const shear = xy * xy + yz * yz + zx * zx;
  return Math.sqrt(0.5 * deviatoric + 3 * shear);
}

/**
 * Returns the eigenvalues of a symmetric 3x3 tensor, sorted descending. The
 * result is exact for the diagonal case and stable for near-degenerate tensors.
 * Any `NaN` component makes all three principal values `NaN`.
 */
export function principalValues(tensor: Tensor6): readonly [number, number, number] {
  const [xx, yy, zz, xy, yz, zx] = tensor;
  if ([xx, yy, zz, xy, yz, zx].some(Number.isNaN)) return [NaN, NaN, NaN];
  if (xy === 0 && yz === 0 && zx === 0) {
    const values = [xx, yy, zz].sort((a, b) => b - a);
    return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
  }
  const trace = xx + yy + zz;
  const pairwise = xx * yy + yy * zz + zz * xx - xy * xy - yz * yz - zx * zx;
  const determinant =
    xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * zx) + zx * (xy * yz - yy * zx);
  const reducedP = pairwise - (trace * trace) / 3;
  const reducedQ = (-2 * trace * trace * trace) / 27 + (trace * pairwise) / 3 - determinant;
  const amplitude = 2 * Math.sqrt(-reducedP / 3);
  if (!(amplitude > Number.EPSILON * Math.max(1, Math.abs(trace)))) {
    const mean = trace / 3;
    return [mean, mean, mean];
  }
  const cosine = ((3 * reducedQ) / (2 * reducedP)) * Math.sqrt(-3 / reducedP);
  const phi = Math.acos(clamp(cosine, -1, 1)) / 3;
  const shift = trace / 3;
  const raw: readonly [number, number, number] = [
    amplitude * Math.cos(phi) + shift,
    amplitude * Math.cos(phi - (2 * Math.PI) / 3) + shift,
    amplitude * Math.cos(phi + (2 * Math.PI) / 3) + shift,
  ];
  const sorted = [...raw].sort((a, b) => b - a);
  return [sorted[0] ?? 0, sorted[1] ?? 0, sorted[2] ?? 0];
}

/**
 * Returns one magnitude per entity of a vector or tensor field. Missing
 * entities (any `NaN` component) become `NaN`.
 */
export function magnitudes<L extends FieldLocation>(
  field: VectorField<L> | TensorField<L>,
): Float32Array {
  const out = new Float32Array(field.count);
  const stride = FIELD_COMPONENT_COUNT[field.shape];
  for (let entity = 0; entity < field.count; entity++) {
    const base = entity * stride;
    out[entity] =
      field.shape === "vector"
        ? magnitude(component(field, base), component(field, base + 1), component(field, base + 2))
        : tensorMagnitude(tensorComponents(field, base));
  }
  return out;
}

/** Returns one von Mises equivalent stress per element of a tensor field. */
export function vonMisesValues<L extends FieldLocation>(field: TensorField<L>): Float32Array {
  const out = new Float32Array(field.count);
  for (let entity = 0; entity < field.count; entity++) {
    out[entity] = vonMises(tensorComponents(field, entity * 6));
  }
  return out;
}

/** Returns each entity's three principal values in a `count * 3` array. */
export function principals<L extends FieldLocation>(field: TensorField<L>): Float32Array {
  const out = new Float32Array(field.count * 3);
  for (let entity = 0; entity < field.count; entity++) {
    const values = principalValues(tensorComponents(field, entity * 6));
    const base = entity * 3;
    out[base] = values[0];
    out[base + 1] = values[1];
    out[base + 2] = values[2];
  }
  return out;
}

/** Derives a scalar field of per-entity vector or tensor magnitudes. */
export function magnitudeField<L extends FieldLocation>(
  id: string,
  name: string,
  source: VectorField<L> | TensorField<L>,
): ResultField<"scalar", L> {
  return derivedScalar(id, name, source, magnitudes(source));
}

/** Derives a scalar field of per-entity von Mises equivalent stress. */
export function vonMisesField<L extends FieldLocation>(
  id: string,
  name: string,
  source: TensorField<L>,
): ResultField<"scalar", L> {
  return derivedScalar(id, name, source, vonMisesValues(source));
}

/** Derives a scalar field of the largest principal value per entity. */
export function maxPrincipalField<L extends FieldLocation>(
  id: string,
  name: string,
  source: TensorField<L>,
): ResultField<"scalar", L> {
  const values = principals(source);
  const out = new Float32Array(source.count);
  for (let entity = 0; entity < source.count; entity++) {
    out[entity] = values[entity * 3] ?? NaN;
  }
  return derivedScalar(id, name, source, out);
}

function derivedScalar<L extends FieldLocation>(
  id: string,
  name: string,
  source: ResultField<"vector" | "tensor", L>,
  values: Float32Array,
): ResultField<"scalar", L> {
  return createResultField({
    id,
    name,
    location: source.location,
    shape: "scalar",
    count: source.count,
    unit: source.unit,
    values,
  });
}

function component<L extends FieldLocation>(
  field: ResultField<FieldShape, L>,
  index: number,
): number {
  return field.values[index] ?? NaN;
}

function tensorComponents<L extends FieldLocation>(
  field: ResultField<FieldShape, L>,
  base: number,
): Tensor6 {
  return [
    component(field, base),
    component(field, base + 1),
    component(field, base + 2),
    component(field, base + 3),
    component(field, base + 4),
    component(field, base + 5),
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
