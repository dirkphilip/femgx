import type { Geometry } from "../geometry/part";
import type { ResultField } from "./fields";

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

/** Returns the geometry with deformed positions, keeping the indices. */
export function deformGeometry(
  geometry: Geometry,
  displacements: ResultField<"vector", "nodal">,
  scale = 1,
): Geometry {
  return {
    positions: deformPositions(geometry.positions, displacements, scale),
    indices: geometry.indices,
  };
}
