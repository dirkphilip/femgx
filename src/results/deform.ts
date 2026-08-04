import type { Geometry } from "../geometry/part";
import type { ResultField, VectorField } from "./fields";

/**
 * Returns a new position array displaced by a nodal displacement field.
 *
 * Vertex index `i` corresponds to node index `i`: `positions` is expected to
 * hold three floats per vertex and to be aligned with the model's node
 * numbering (at most the field's entity count, since geometry may only cover a
 * subset of nodes). Vertices whose displacement is missing (`NaN`) keep their
 * original position. `scale` multiplies the displacement only.
 */
export function deformPositions(
  positions: Float32Array,
  displacements: ResultField<"vector", "nodal">,
  scale = 1,
): Float32Array {
  const deformed = new Float32Array(positions);
  const vertexCount = Math.min(Math.floor(positions.length / 3), displacements.count);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const base = vertex * 3;
    const dx = displacements.values[base];
    const dy = displacements.values[base + 1];
    const dz = displacements.values[base + 2];
    if (
      dx === undefined ||
      dy === undefined ||
      dz === undefined ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      !Number.isFinite(dz)
    ) {
      continue;
    }
    deformed[base] = (positions[base] ?? 0) + dx * scale;
    deformed[base + 1] = (positions[base + 1] ?? 0) + dy * scale;
    deformed[base + 2] = (positions[base + 2] ?? 0) + dz * scale;
  }
  return deformed;
}

/**
 * Returns the geometry with deformed positions. All other geometry data
 * (indices and any element tessellations) is preserved.
 */
export function deformGeometry(
  geometry: Geometry,
  displacements: ResultField<"vector", "nodal">,
  scale = 1,
): Geometry {
  return {
    ...geometry,
    positions: deformPositions(geometry.positions, displacements, scale),
  };
}

/**
 * Builds a per-vertex nodal displacement buffer for GPU-side deformation: one
 * vec3 per vertex of `positions` per load case, laid out load-case major
 * (`[case 0 vertex 0, case 0 vertex 1, ..., case 1 vertex 0, ...]`). Vertex `i`
 * aligns with node `i` as in {@link deformPositions}; vertices beyond a field's
 * entity count, or whose displacement is missing (`NaN`), keep a zero delta so
 * the vertex stays in place on the GPU. The returned array is what
 * `DeformationState.displacements` expects for one part.
 */
export function nodalDisplacements(
  positions: Float32Array,
  cases: readonly VectorField<"nodal">[],
): Float32Array {
  const vertexCount = Math.floor(positions.length / 3);
  const displacements = new Float32Array(vertexCount * cases.length * 3);
  for (let loadCase = 0; loadCase < cases.length; loadCase++) {
    const field = cases[loadCase];
    if (field === undefined) continue;
    const covered = Math.min(vertexCount, field.count);
    const caseOffset = loadCase * vertexCount * 3;
    for (let vertex = 0; vertex < covered; vertex++) {
      const source = vertex * 3;
      const target = caseOffset + vertex * 3;
      displacements[target] = finiteOrZero(field.values[source]);
      displacements[target + 1] = finiteOrZero(field.values[source + 1]);
      displacements[target + 2] = finiteOrZero(field.values[source + 2]);
    }
  }
  return displacements;
}

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}
