import type { FaceKey } from "../elements/faces";
import type { NodeId } from "../elements/element";
import type { ElementId, PartId } from "../scene/types";

/** Stable identity of one oriented element face within a part. */
export type FaceId = number;

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

/**
 * The tessellation of one oriented element face: a stable part-local face id
 * plus the element, face index, canonical key, ordered node loop, and the
 * elements that share the face's canonical key (its neighbors).
 */
export interface FaceTessellation {
  /** Stable part-local face id (indexes this list). */
  readonly id: FaceId;
  /** The element owning this oriented face. */
  readonly elementId: ElementId;
  /** Index of the face within the element's canonical face list. */
  readonly faceIndex: number;
  /** Canonical identity shared by coincident faces. */
  readonly key: FaceKey;
  /** Outward-oriented node loop; interleaves mid-edge nodes when quadratic. */
  readonly nodeIds: readonly NodeId[];
  /** Other elements incident to the same canonical face (empty on boundaries). */
  readonly neighborElementIds: readonly ElementId[];
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
  /**
   * Optional per-vertex node pick ids: `nodeId + 1` for vertices that come from
   * a model node, `0` for interpolated tessellation vertices (e.g. the center
   * of a quadratic quad). When present the part is node-pickable and the
   * renderer's deformed-shape path uses the map to resolve each vertex back to
   * its node's displacement, so tessellated geometry deforms correctly.
   */
  readonly nodePickIds?: Uint32Array;
  /**
   * Optional node positions indexed directly by `NodeId` (three floats per
   * node), used to resolve node picks to local/world positions on the CPU.
   */
  readonly nodePositions?: Float32Array;
  /**
   * Optional per-triangle face pick ids: `faceId + 1`, `0` = no face. When
   * present the part is face-pickable and every triangle must reference a
   * valid face id (or `0`).
   */
  readonly facePickIds?: Uint32Array;
  /** Optional face descriptors in ascending `id` order. */
  readonly faces?: readonly FaceTessellation[];
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

/** Returns whether every component of a bounding box is finite. */
export function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.minZ) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    Number.isFinite(bounds.maxZ)
  );
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

/**
 * Validates the optional node/face pick-id arrays against the geometry's
 * vertex and triangle counts and the declared face descriptors.
 */
export function validatePickIds(geometry: Geometry): void {
  const vertexCount = geometry.positions.length / 3;
  if (geometry.nodePickIds !== undefined && geometry.nodePickIds.length !== vertexCount) {
    throw new Error(
      `nodePickIds must have one entry per vertex (${vertexCount}), got ${geometry.nodePickIds.length}`,
    );
  }
  const triangleCount = Math.floor(geometry.indices.length / 3);
  if (geometry.facePickIds !== undefined && geometry.facePickIds.length !== triangleCount) {
    throw new Error(
      `facePickIds must have one entry per triangle (${triangleCount}), got ${geometry.facePickIds.length}`,
    );
  }
  if (geometry.faces !== undefined) {
    const seen = new Set<FaceId>();
    geometry.faces.forEach((face, index) => {
      if (face.id !== index) {
        throw new Error(`Face ${face.id} is not at its id index ${index}`);
      }
      if (seen.has(face.id)) {
        throw new Error(`Duplicate face id ${face.id}`);
      }
      seen.add(face.id);
    });
  }
}

export type { PartId } from "../scene/types";
