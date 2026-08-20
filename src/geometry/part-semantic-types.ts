import type { ElementTessellation, FaceTessellation, GeometryBody, GeometryEdge } from "./types";
import type { BodyId } from "../elements/model";

type ElementId = ElementTessellation["id"];

export interface FaceMetadata {
  readonly face: FaceTessellation;
  readonly faceId: number;
}

/** Internal semantic queries shared by renderer interaction and reconciliation. */
export interface PartSemanticIndex {
  readonly elementCount: number;
  element(id: ElementId): ElementTessellation | undefined;
  hasElement(id: ElementId): boolean;
  /** Stable private ordinal (`1..n`) for one authored element id. */
  elementOrdinal(id: ElementId): number | undefined;
  body(id: BodyId): GeometryBody | undefined;
  hasBody(id: BodyId): boolean;
  bodyForElement(id: ElementId): BodyId | undefined;
  face(elementId: ElementId, faceIndex: number): FaceMetadata | undefined;
  hasFace(elementId: ElementId, faceIndex: number): boolean;
  edge(key: string): GeometryEdge | undefined;
  hasEdge(key: string): boolean;
  /** Whether a body id can affect authored surface visibility for this part. */
  hasVisibilityBody(id: BodyId): boolean;
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
