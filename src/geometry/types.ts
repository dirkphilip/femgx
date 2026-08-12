import type { ElementId, NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import type { ElementShape } from "../elements/shapes";

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
 * The tessellation of one finite element: a stable element id plus a
 * contiguous range of the part's logical primitives. Elements are the unit of
 * element-level picking, selection, and result mapping.
 */
export interface ElementTessellation {
  readonly id: ElementId;
  /** First logical primitive of this element. */
  readonly primitiveStart: number;
  /** Number of logical primitives owned by this element. */
  readonly primitiveCount: number;
  /** Original FE shape, when the source model retained typed shape metadata. */
  readonly shape?: ElementShape;
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

interface GeometryBase {
  /**
   * `createPart` retains these typed arrays without copying and owns them for
   * the lifetime of the returned part. Callers must not mutate or reuse them
   * after construction.
   */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Optional element tessellations covering the logical primitives. */
  readonly elements?: readonly ElementTessellation[];
  /**
   * Optional per-vertex node pick ids: `nodeId + 1` for vertices that come from
   * an authored model node. When present the part is node-pickable and the
   * renderer's deformed-shape path uses the map to resolve each vertex back to
   * its node's displacement, so tessellated geometry deforms correctly.
   */
  readonly nodePickIds?: Uint32Array;
  /**
   * Optional node positions indexed directly by `NodeId` (three floats per
   * node), used to resolve node picks to local/world positions on the CPU.
   */
  readonly nodePositions?: Float32Array;
  /** Optional logical bodies in ascending `id` order. */
  readonly bodies?: readonly Body[];
}

/** CPU-side triangle geometry descriptor; the renderer uploads this once. */
export interface TriangleGeometry extends GeometryBase {
  readonly primitive: "triangles";
  /** Optional per-triangle face pick ids: `faceId + 1`, `0` = no face. */
  readonly facePickIds?: Uint32Array;
  /** Optional face descriptors in ascending `id` order. */
  readonly faces?: readonly FaceTessellation[];
  /** Optional render-time subset of the declared triangle faces. */
  readonly faceSubset?: FaceSubset;
}

/** CPU-side line geometry descriptor. */
export interface LineGeometry extends GeometryBase {
  readonly primitive: "lines";
}

/** CPU-side logical-point geometry descriptor. */
export interface PointGeometry extends GeometryBase {
  readonly primitive: "points";
}

/** CPU-side non-triangle geometry descriptors. */
export type LinearGeometry = LineGeometry | PointGeometry;

/** CPU-side geometry descriptor; the renderer uploads this once. */
export type Geometry = TriangleGeometry | LinearGeometry;
