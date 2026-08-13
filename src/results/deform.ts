import type { Geometry } from "../geometry/part";
import type { PartId } from "../geometry/part";
import type { ResultField, VectorField } from "./fields";

/**
 * CPU-side deformation data consumed by the viewport and renderer. Each
 * displacement array stores three floats per model node.
 */
export interface DeformationState {
  /** Multiplier applied to the authored nodal displacement field. */
  readonly scale: number;
  /** Per-part nodal displacement arrays used by GPU vertex deformation. */
  readonly displacements: ReadonlyMap<PartId, Float32Array>;
}

/**
 * Returns a new position array displaced by a nodal displacement field.
 *
 * Vertices are mapped to their model node through `nodePickIds` (one entry per
 * vertex, `nodeId + 1`, `0` for vertices without a node), so indexed
 * tessellated geometry deforms through its FE nodes instead of assuming vertex
 * `i` is node `i`. Custom geometry may still duplicate a source node at
 * multiple output vertices, while node-less vertices remain fixed.
 * Vertices without a matching displacement, or whose displacement is missing
 * (`NaN`), keep their original position. `scale` multiplies the displacement only.
 */
export function deformPositions(
  positions: Float32Array,
  nodePickIds: Uint32Array,
  displacements: ResultField<"vector", "nodal">,
  scale = 1,
): Float32Array {
  const deformed = new Float32Array(positions);
  const vertexCount = Math.min(Math.floor(positions.length / 3), nodePickIds.length);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const nodePickId = nodePickIds[vertex];
    if (nodePickId === undefined || nodePickId === 0) continue;
    const nodeId = nodePickId - 1;
    if (nodeId >= displacements.count) continue;
    const base = vertex * 3;
    const source = nodeId * 3;
    const dx = displacements.values[source];
    const dy = displacements.values[source + 1];
    const dz = displacements.values[source + 2];
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
 * Returns the geometry with deformed positions. The part must carry a
 * per-vertex node map (`nodePickIds`) to resolve vertices back to their model
 * nodes, which `heterogeneousElementParts` provides for element-backed geometry. All other
 * geometry data (indices and any element tessellations) is preserved.
 */
export function deformGeometry(
  geometry: Geometry,
  displacements: ResultField<"vector", "nodal">,
  scale = 1,
): Geometry {
  const nodePickIds = geometry.nodePickIds;
  if (nodePickIds === undefined) {
    throw new Error(
      "Cannot deform geometry without per-vertex node ids; build it with heterogeneousElementParts or supply nodePickIds",
    );
  }
  return {
    ...geometry,
    positions: deformPositions(geometry.positions, nodePickIds, displacements, scale),
  };
}

/**
 * Builds a per-node nodal displacement buffer for GPU-side deformation: one
 * vec3 per model node, indexed by `NodeId`. The
 * renderer maps each vertex to its node through the part's per-vertex node
 * pick ids, so `nodeCount` is the owning model's node count (the largest node
 * id used by the part's vertices plus one). Nodes beyond a field's entity
 * count, or whose displacement is missing (`NaN`), keep a zero delta so the
 * vertex stays in place on the GPU. The returned array is what
 * `DeformationState.displacements` expects for one part.
 */
export function nodalDisplacements(
  nodeCount: number,
  field: VectorField<"nodal"> | undefined,
): Float32Array {
  const displacements = new Float32Array(nodeCount * 3);
  if (field === undefined) return displacements;
  const covered = Math.min(nodeCount, field.count);
  for (let node = 0; node < covered; node++) {
    const source = node * 3;
    displacements[source] = finiteOrZero(field.values[source]);
    displacements[source + 1] = finiteOrZero(field.values[source + 1]);
    displacements[source + 2] = finiteOrZero(field.values[source + 2]);
  }
  return displacements;
}

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}
