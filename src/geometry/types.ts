import type { BodyId, ElementBlockId } from "../elements/model";
import type { ElementId, NodeId } from "../elements/element";
import type { FaceIdRef, FaceKey } from "../elements/faces";
import type { EdgeKey } from "../elements/edges";
import type { ElementShape } from "../elements/shapes";

/**
 * Stable set of part-local faces selected for solid/pick rendering.
 * @category Scene and geometry
 */
export interface FaceSubset {
  /** Oriented element-face identities to draw. An empty set draws nothing. */
  readonly faceIds: readonly FaceIdRef[];
}

/**
 * Derived body metadata carried by a renderable part.
 * @category Scene and geometry
 */
export interface GeometryBody {
  readonly id: BodyId;
  readonly name?: string;
  /** Element ids belonging to this body, in ascending order. */
  readonly elementIds: readonly ElementId[];
}

/**
 * Derived semantic block metadata carried by a renderable part.
 * @category Scene and geometry
 */
export interface GeometryElementBlock {
  readonly id: ElementBlockId;
  readonly name?: string;
  /** Elements from the source block present in this primitive group. */
  readonly elementIds: readonly ElementId[];
}

/**
 * Axis-aligned bounding box in local part space.
 * @category Scene and geometry
 */
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
 * @category Scene and geometry
 */
export interface ElementTessellation {
  readonly id: ElementId;
  /** Every topology-local primitive range owned by this semantic element. */
  readonly primitiveRanges?: readonly ElementPrimitiveRange[];
  /** Transitional single-range view while consumers migrate. */
  readonly primitiveStart: number;
  /** Transitional single-range view while consumers migrate. */
  readonly primitiveCount: number;
  /** Original FE shape, when the source model retained typed shape metadata. */
  readonly shape?: ElementShape;
  /** Optional logical body owning this element. */
  readonly bodyId?: BodyId;
  /** Optional semantic element block owning this element. */
  readonly blockId?: ElementBlockId;
}

/** One topology-local primitive range owned by an element. */
export interface ElementPrimitiveRange {
  readonly primitive: Primitive;
  readonly primitiveStart: number;
  readonly primitiveCount: number;
}

/**
 * The tessellation of one oriented element face. Its primitive range is the
 * only renderer-facing mapping needed to resolve triangles back to this
 * authored identity; dense GPU pick ids are derived privately by the renderer.
 * @category Scene and geometry
 */
export interface FaceTessellation {
  /** The element owning this oriented face. */
  readonly elementId: ElementId;
  /** Index of the face within the element's canonical face list. */
  readonly faceIndex: number;
  /** First logical triangle emitted for this oriented face. */
  readonly primitiveStart: number;
  /** Number of logical triangles emitted for this oriented face. */
  readonly primitiveCount: number;
  /** Canonical identity shared by coincident faces. */
  readonly key: FaceKey;
  /** Outward-oriented node loop; interleaves mid-edge nodes when quadratic. */
  readonly nodeIds: readonly NodeId[];
  /** Other elements incident to the same canonical face (empty on boundaries). */
  readonly neighborElementIds: readonly ElementId[];
  /** Optional logical body owning the face's element. */
  readonly bodyId?: BodyId;
  /** Optional semantic element block owning this face's element. */
  readonly blockId?: ElementBlockId;
}

/**
 * Stable authored-edge metadata retained alongside tessellated geometry.
 *
 * The node sequence is `[corner, corner]` for linear edges and
 * `[corner, mid, corner]` for quadratic edges. Renderer-private tessellation
 * segments may refer back to this one identity, so a shared authored edge is
 * never confused with a tessellation diagonal.
 * @category Scene and geometry
 */
export interface GeometryEdge {
  /** Canonical identity independent of the element's orientation. */
  readonly key: EdgeKey;
  /** Canonical authored node sequence. */
  readonly nodeIds: readonly NodeId[];
  /** Elements incident to this edge, in ascending id order. */
  readonly incidentElementIds: readonly ElementId[];
  /** Oriented element faces that contain this edge. */
  readonly faceRefs: readonly FaceIdRef[];
}

/**
 * How a part's indexed primitives are drawn on the GPU.
 * @category Scene and geometry
 */
export type Primitive = "triangles" | "lines" | "points";

interface GeometryBase {
  /**
   * `createPart` retains these typed arrays without copying and owns them for
   * the lifetime of the returned part. Callers must not mutate or reuse them
   * after construction.
   */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Transitional metadata view while Part consumers migrate. */
  readonly elements?: readonly ElementTessellation[];
  readonly bodies?: readonly GeometryBody[];
  readonly blocks?: readonly GeometryElementBlock[];
  /** Optional stable authored FE edges; absent for generic display geometry. */
  readonly edges?: readonly GeometryEdge[];
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
}

/**
 * CPU-side triangle geometry descriptor; the renderer uploads this once.
 * @category Scene and geometry
 */
export interface TriangleGeometry extends GeometryBase {
  readonly primitive: "triangles";
  /** Optional oriented face descriptors with exact triangle ranges. */
  readonly faces?: readonly FaceTessellation[];
  /** Optional render-time subset of the declared triangle faces. */
  readonly faceSubset?: FaceSubset;
}

/**
 * CPU-side line geometry descriptor.
 * @category Scene and geometry
 */
export interface LineGeometry extends GeometryBase {
  readonly primitive: "lines";
}

/**
 * CPU-side logical-point geometry descriptor.
 * @category Scene and geometry
 */
export interface PointGeometry extends GeometryBase {
  readonly primitive: "points";
}

/** CPU-side non-triangle geometry descriptors. */
/**
 * CPU-side geometry descriptor; the renderer uploads this once.
 * @category Scene and geometry
 */
export type Geometry = TriangleGeometry | LineGeometry | PointGeometry;
