import type { PartId } from "./types";

/** Axis-aligned bounding box in local part space. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** CPU-side geometry descriptor; the renderer uploads this once. */
export interface Geometry {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * Reusable, immutable drawable geometry. Parts never own world transforms;
 * they are shared and instanced many times by assemblies.
 */
export interface Part {
  readonly id: PartId;
  readonly geometry: Geometry;
  readonly bounds: Bounds;
}

/** Computes the bounding box of a geometry's positions. */
export function computeBounds(geometry: Geometry): Bounds {
  const mins = { minX: Infinity, minY: Infinity, minZ: Infinity };
  const maxs = { maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < geometry.positions.length; i += 3) {
    const x = geometry.positions[i] ?? 0;
    const y = geometry.positions[i + 1] ?? 0;
    const z = geometry.positions[i + 2] ?? 0;
    if (x < mins.minX) mins.minX = x;
    if (y < mins.minY) mins.minY = y;
    if (z < mins.minZ) mins.minZ = z;
    if (x > maxs.maxX) maxs.maxX = x;
    if (y > maxs.maxY) maxs.maxY = y;
    if (z > maxs.maxZ) maxs.maxZ = z;
  }
  return { ...mins, ...maxs };
}

export type { PartId } from "./types";
