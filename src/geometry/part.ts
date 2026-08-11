import type { FaceKey } from "../elements/faces";
import type { NodeId } from "../elements/element";
import type { ElementId, PartId } from "../scene/types";

/** Stable identity of one oriented element face within a part. */
export type FaceId = number;

/** Stable set of part-local faces selected for solid/pick rendering. */
export interface FaceSubset {
  /** Face ids index the part's declared `faces` array. An empty set draws nothing. */
  readonly faceIds: readonly FaceId[];
}

/** Stable identity of one logical body within a reusable part. */
export type BodyId = number;

/** Read-only logical body metadata owned by a part's geometry. */
export interface Body {
  readonly id: BodyId;
  readonly name?: string;
  /** Element ids belonging to this body, in ascending order. */
  readonly elementIds: readonly ElementId[];
}

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
  /** Optional logical body owning this element. */
  readonly bodyId?: BodyId;
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
  /** Optional logical body owning the face's element. */
  readonly bodyId?: BodyId;
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
  /** Optional render-time subset of the declared triangle faces. */
  readonly faceSubset?: FaceSubset;
  /** Optional logical bodies in ascending `id` order. */
  readonly bodies?: readonly Body[];
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

export {
  bodyIdForElement,
  GeometryValidationError,
  validateBodies,
  validateElements,
  validateFaceSubset,
  validatePickIds,
} from "./part-validation";
export type { GeometryValidationCode } from "./part-validation";

export type { PartId } from "../scene/types";
