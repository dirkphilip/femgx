import type { BodyId } from "../elements/model";
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

/** Query-only selected face identities owned by one retained triangle geometry leaf. */
export interface GeometryFaceSubset extends Iterable<FaceIdRef> {
  /** Number of selected oriented faces. */
  readonly count: number;
  /** Returns one selected face identity by retained ordinal. */
  at(ordinal: number): FaceIdRef | undefined;
  /** Iterates retained ordinals and selected face identities. */
  entries(): IterableIterator<[number, FaceIdRef]>;
}

/** Query-only authored-edge metadata owned by one retained geometry leaf. */
export interface GeometryEdges extends Iterable<GeometryEdge> {
  /** Number of authored edges. */
  readonly count: number;
  /** Returns a fresh edge descriptor for one canonical edge key. */
  get(key: string): GeometryEdge | undefined;
  /** Returns a fresh edge descriptor by retained ordinal. */
  at(ordinal: number): GeometryEdge | undefined;
  /** Iterates retained ordinals and fresh edge descriptors. */
  entries(): IterableIterator<[number, GeometryEdge]>;
}

/**
 * Derived body metadata carried by a renderable part.
 * @category Scene and geometry
 */
export interface GeometryBody {
  /** Stable body identifier shared with the source element model. */
  readonly id: BodyId;
  /** Optional host-facing display name. */
  readonly name?: string;
  /** Element ids belonging to this body, in ascending order. */
  readonly elementIds: readonly ElementId[];
}

/**
 * Axis-aligned bounding box in local part space.
 * @category Scene and geometry
 */
export interface Bounds {
  /** Minimum x coordinate in local part space. */
  readonly minX: number;
  /** Minimum y coordinate in local part space. */
  readonly minY: number;
  /** Minimum z coordinate in local part space. */
  readonly minZ: number;
  /** Maximum x coordinate in local part space. */
  readonly maxX: number;
  /** Maximum y coordinate in local part space. */
  readonly maxY: number;
  /** Maximum z coordinate in local part space. */
  readonly maxZ: number;
}

/**
 * The tessellation of one finite element: a stable element id plus a
 * contiguous range of the part's logical primitives. Elements are the unit of
 * element-level picking, selection, and result mapping.
 * @category Scene and geometry
 */
export interface ElementTessellation {
  /** Stable authored finite-element identifier. */
  readonly id: ElementId;
  /** Every topology-local primitive range owned by this semantic element. */
  readonly primitiveRanges: readonly ElementPrimitiveRange[];
  /** Original FE shape, when the source model retained typed shape metadata. */
  readonly shape?: ElementShape;
  /** Optional logical body owning this element. */
  readonly bodyId?: BodyId;
}

/**
 * One topology-local primitive range owned by an element.
 * @category Scene and geometry
 */
export interface ElementPrimitiveRange {
  /** Primitive topology of the referenced geometry group. */
  readonly primitive: Primitive;
  /** First logical primitive in that geometry group. */
  readonly primitiveStart: number;
  /** Number of contiguous logical primitives owned by the element. */
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
  /** The other element incident to this face, when it is an interior face. */
  readonly neighborElementId?: ElementId;
  /** Optional logical body owning the face's element. */
  readonly bodyId?: BodyId;
}

/** Query-only authored-face metadata owned by one retained triangle geometry leaf. */
export interface GeometryFaces extends Iterable<FaceTessellation> {
  /** Number of retained oriented faces. */
  readonly count: number;
  /** Returns a fresh face descriptor for one stable element-face identity. */
  get(elementId: number, faceIndex: number): FaceTessellation | undefined;
  /** Returns a fresh face descriptor by retained ordinal. */
  at(ordinal: number): FaceTessellation | undefined;
  /** Iterates retained ordinals and fresh face descriptors. */
  entries(): IterableIterator<[number, FaceTessellation]>;
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
  /** Optional stable authored FE edges; absent for generic display geometry. */
  readonly edges?: GeometryEdges;
  /**
   * Optional per-vertex node pick ids: `nodeId + 1` for vertices that come from
   * an authored model node. When present the part is node-pickable and the
   * renderer's deformed-shape path uses the map to resolve each vertex back to
   * its node's displacement, so tessellated geometry deforms correctly.
   */
  readonly nodePickIds?: Uint32Array;
}

/**
 * CPU-side triangle geometry descriptor; the renderer uploads this once.
 * @category Scene and geometry
 */
export interface TriangleGeometry extends GeometryBase {
  /** Triangle index topology. */
  readonly primitive: "triangles";
  /** Indexed triangles; three indices per triangle. */
  readonly indices: Uint32Array;
  /** Optional RGBA color for each logical triangle, in triangle order. */
  readonly primitiveColors?: Float32Array;
  /**
   * Optional renderer-ready display edge endpoint pairs. Each pair indexes
   * `positions`; this is for generic display geometry without authored FE
   * edge identities.
   */
  readonly presentationEdges?: Uint32Array;
  /** Optional graph-backed oriented face inspection capability. */
  readonly faces?: GeometryFaces;
  /** Optional graph-backed subset of declared triangle faces. */
  readonly faceSubset?: GeometryFaceSubset;
}

/**
 * CPU-side line geometry descriptor.
 * @category Scene and geometry
 */
export interface LineGeometry extends GeometryBase {
  /** Line-segment index topology. */
  readonly primitive: "lines";
  /** Indexed line segments; two indices per segment. */
  readonly indices: Uint32Array;
}

/**
 * CPU-side logical-point geometry descriptor.
 * @category Scene and geometry
 */
export interface PointGeometry extends GeometryBase {
  /** Point index topology. */
  readonly primitive: "points";
  /** Indexed points; one index per point. */
  readonly indices: Uint32Array;
}

/** CPU-side non-triangle geometry descriptors. */
/**
 * CPU-side geometry descriptor; the renderer uploads this once.
 * @category Scene and geometry
 */
export type Geometry = TriangleGeometry | LineGeometry | PointGeometry;

/** Transient descriptor-bearing geometry accepted only by the Part boundary. */
interface GeometryInputBase extends Omit<GeometryBase, "edges"> {
  /** Optional authored FE-edge descriptors compiled into packed columns. */
  readonly edges?: readonly GeometryEdge[];
}

/** Transient triangle authoring input; face descriptors are not retained by output geometry. */
export interface TriangleGeometryInput
  extends GeometryInputBase, Omit<TriangleGeometry, "edges" | "faces" | "faceSubset"> {
  /** Indexed triangles; three indices per triangle. */
  readonly indices: Uint32Array;
  /** Optional oriented face descriptors compiled into packed columns. */
  readonly faces?: readonly FaceTessellation[];
  /** Optional authored subset of the declared oriented faces. */
  readonly faceSubset?: FaceSubset;
}

/** Transient line authoring input. */
export interface LineGeometryInput extends GeometryInputBase, Omit<LineGeometry, "edges"> {
  /** Indexed line segments; two indices per segment. */
  readonly indices: Uint32Array;
}

/** Transient point authoring input. */
export interface PointGeometryInput extends GeometryInputBase, Omit<PointGeometry, "edges"> {
  /** Indexed points; one index per point. */
  readonly indices: Uint32Array;
}

/** One transient geometry leaf accepted while building an immutable Part. */
export type GeometryInput = TriangleGeometryInput | LineGeometryInput | PointGeometryInput;
