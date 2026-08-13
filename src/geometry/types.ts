import type { BodyId, ElementBlockId } from "../elements/model";
import type { ElementId, NodeId } from "../elements/element";
import type { FaceIdRef, FaceKey } from "../elements/faces";
import type { ElementShape } from "../elements/shapes";

/** Stable set of part-local faces selected for solid/pick rendering. */
export interface FaceSubset {
  /** Oriented element-face identities to draw. An empty set draws nothing. */
  readonly faceIds: readonly FaceIdRef[];
}

/** Derived body metadata carried by a renderable part. */
export interface GeometryBody {
  readonly id: BodyId;
  readonly name?: string;
  /** Element ids belonging to this body, in ascending order. */
  readonly elementIds: readonly ElementId[];
}

/** Derived semantic block metadata carried by a renderable part. */
export interface GeometryElementBlock {
  readonly id: ElementBlockId;
  readonly name?: string;
  /** Elements from the source block present in this primitive group. */
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
  /** Optional semantic element block owning this element. */
  readonly blockId?: ElementBlockId;
}

/**
 * The tessellation of one oriented element face. Its primitive range is the
 * only renderer-facing mapping needed to resolve triangles back to this
 * authored identity; dense GPU pick ids are derived privately by the renderer.
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
  /** Derived bodies; block-defined source bodies are flattened to elements. */
  readonly bodies?: readonly GeometryBody[];
  /** Derived semantic blocks, omitted on the blockless path. */
  readonly blocks?: readonly GeometryElementBlock[];
}

/** CPU-side triangle geometry descriptor; the renderer uploads this once. */
export interface TriangleGeometry extends GeometryBase {
  readonly primitive: "triangles";
  /** Optional oriented face descriptors with exact triangle ranges. */
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
