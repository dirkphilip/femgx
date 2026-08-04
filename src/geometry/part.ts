import type { ElementId, PartId } from "../scene/types";

/** Axis-aligned bounding box in local part space. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * The tessellation of one finite element: a stable element id (matching the
 * `ElementId` of the FE model) plus the contiguous range of triangles in the
 * part's index buffer that draw it. Elements are the unit of element-level
 * picking and selection.
 */
export interface ElementTessellation {
  readonly id: ElementId;
  /** First triangle of this element (each triangle is three indices). */
  readonly triangleStart: number;
  readonly triangleCount: number;
}

/** How a part's indexed primitives are drawn on the GPU. */
export type Primitive = "triangles" | "lines" | "points";

/** CPU-side geometry descriptor; the renderer uploads this once. */
export interface Geometry {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /**
   * Primitive kind, defaulting to `"triangles"`. `"points"` geometry is a
   * screen-space sprite mesh; `"lines"` geometry uses `line-list` primitives.
   */
  readonly primitive?: Primitive;
  /**
   * Optional element tessellations. When absent the part is not element-pickable
   * and every triangle reports "no element". When present, every triangle must
   * belong to exactly one element.
   */
  readonly elements?: readonly ElementTessellation[];
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
  return computePositionsBounds(geometry.positions);
}

/**
 * Computes the bounding box of raw positions (single or double precision).
 * Streaming parses untrusted model data that may arrive as doubles, so bounds
 * are computed before the positions are converted to near-origin float32.
 */
export function computePositionsBounds(positions: Float32Array | Float64Array): Bounds {
  const mins = { minX: Infinity, minY: Infinity, minZ: Infinity };
  const maxs = { maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (x < mins.minX) mins.minX = x;
    if (y < mins.minY) mins.minY = y;
    if (z < mins.minZ) mins.minZ = z;
    if (x > maxs.maxX) maxs.maxX = x;
    if (y > maxs.maxY) maxs.maxY = y;
    if (z > maxs.maxZ) maxs.maxZ = z;
  }
  return { ...mins, ...maxs };
}

/**
 * Validates element descriptors against an index buffer. When elements are
 * declared, every triangle must be covered by exactly one element and ids must
 * be unique. Geometry without element descriptors always validates. The
 * parameter is structural so streaming can validate chunk data that has not
 * been converted to float32 positions yet.
 */
export function validateElements(geometry: {
  readonly indices: Uint32Array;
  readonly elements?: readonly ElementTessellation[];
}): void {
  const elements = geometry.elements;
  if (elements === undefined || elements.length === 0) {
    return;
  }
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const coverage = new Uint8Array(triangleCount);
  const seenIds = new Set<ElementId>();
  for (const element of elements) {
    if (element.triangleCount <= 0) {
      throw new Error(`Element ${element.id} has no triangles`);
    }
    if (seenIds.has(element.id)) {
      throw new Error(`Duplicate element id ${element.id}`);
    }
    seenIds.add(element.id);
    const end = element.triangleStart + element.triangleCount;
    if (element.triangleStart < 0 || end > triangleCount) {
      throw new Error(`Element ${element.id} is outside the index buffer`);
    }
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      if (coverage[triangle] === 1) {
        throw new Error(`Triangle ${triangle} belongs to more than one element`);
      }
      coverage[triangle] = 1;
    }
  }
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (coverage[triangle] === 0) {
      throw new Error(`Triangle ${triangle} is not covered by any element`);
    }
  }
}

export type { PartId } from "../scene/types";
