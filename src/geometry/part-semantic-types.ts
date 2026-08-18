import type { ElementTessellation, FaceTessellation, GeometryBody, GeometryEdge } from "./types";
import type { BodyId } from "../elements/model";

type ElementId = ElementTessellation["id"];

export interface FaceMetadata {
  readonly face: FaceTessellation;
  readonly faceId: number;
}

/** Minimal map contract used by packed lookups without a native Map entry heap. */
export interface SemanticMap<K, V> {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  entries(): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  forEach(callbackfn: (value: V, key: K, map: SemanticMap<K, V>) => void): void;
  [Symbol.iterator](): IterableIterator<[K, V]>;
}

/** Internal semantic lookups shared by renderer interaction and reconciliation. */
export interface PartSemanticIndex {
  readonly elements: SemanticMap<ElementId, ElementTessellation>;
  /** Stable private ordinal (`1..n`) for each authored element id. */
  readonly elementOrdinalById: SemanticMap<ElementId, number>;
  readonly bodies: ReadonlyMap<BodyId, GeometryBody>;
  readonly bodyByElement: SemanticMap<ElementId, BodyId>;
  /** Body ids that can affect authored surface visibility for this part. */
  readonly visibilityBodyIds: ReadonlySet<BodyId>;
  readonly faces: SemanticMap<string, FaceMetadata>;
  readonly edges: SemanticMap<string, GeometryEdge>;
  readonly nodeCount: number;
  /** CSR offsets for authored triangle-face incidence by part-local node id. */
  readonly nodeTriangleFaceOffsets: Uint32Array;
  /** Face ids referenced by the CSR node-incidence ranges above. */
  readonly nodeTriangleFaceIds: Uint32Array;
  /** CSR offsets for authored triangle faces grouped by neighboring element. */
  readonly neighborTriangleFaceOffsets: Uint32Array;
  /** Face ids referenced by neighboring-element CSR ranges. */
  readonly neighborTriangleFaceIds: Uint32Array;
  /** Private ordinals for elements with non-triangle primitive ranges. */
  readonly nonTriangleElementOrdinals: Uint32Array;
  /** Whether the declared triangle subset contains only exterior faces. */
  readonly hasBoundaryFaceSubset: boolean;
  /** Whether every authored triangle neighbor resolves to a local element. */
  readonly hasCompleteNeighborTriangleIndex: boolean;
}
