import type { ElementTessellation, FaceTessellation, GeometryBody, GeometryEdge } from "./types";
import type { BodyId, Part } from "./part";
import { faceIdentity } from "./element-face-selection";

export { compareNodeIds as compareEdgeNodeIds } from "../elements/edges";

type ElementId = ElementTessellation["id"];

interface FaceMetadata {
  readonly face: FaceTessellation;
  readonly faceId: number;
}

/** Immutable semantic lookups shared by renderer interaction and viewport reconciliation. */
export interface PartSemanticIndex {
  readonly elements: ReadonlyMap<ElementId, ElementTessellation>;
  /** Stable private ordinal (`1..n`) for each authored element id. */
  readonly elementOrdinalById: ReadonlyMap<ElementId, number>;
  readonly bodies: ReadonlyMap<BodyId, GeometryBody>;
  readonly bodyByElement: ReadonlyMap<ElementId, BodyId>;
  readonly faces: ReadonlyMap<string, FaceMetadata>;
  readonly edges: ReadonlyMap<string, GeometryEdge>;
  readonly nodeCount: number;
}

const indexByPart = new WeakMap<Part, PartSemanticIndex>();

/** Returns the cached immutable semantic index for one validated part identity. */
export function getPartSemanticIndex(part: Part): PartSemanticIndex {
  const cached = indexByPart.get(part);
  if (cached !== undefined) return cached;
  const index = buildPartSemanticIndex(part);
  indexByPart.set(part, index);
  return index;
}

function buildPartSemanticIndex(part: Part): PartSemanticIndex {
  const { elements: partElements = [], bodies: partBodies = [] } = part;
  const elements = new Map(partElements.map((element) => [element.id, element]));
  const elementOrdinalById = new Map(partElements.map((element, index) => [element.id, index + 1]));
  const bodies = new Map(partBodies.map((body) => [body.id, body]));
  const bodyByElement = new Map<ElementId, BodyId>();
  for (const element of partElements) {
    if (element.bodyId !== undefined) bodyByElement.set(element.id, element.bodyId);
  }
  for (const body of partBodies) {
    for (const elementId of body.elementIds) {
      if (!bodyByElement.has(elementId)) bodyByElement.set(elementId, body.id);
    }
  }
  const faces = new Map<string, FaceMetadata>();
  const triangleGeometry = part.geometries.find((geometry) => geometry.primitive === "triangles");
  if (triangleGeometry?.primitive === "triangles") {
    for (const [faceId, face] of (triangleGeometry.faces ?? []).entries()) {
      faces.set(faceIdentity(face.elementId, face.faceIndex), { face, faceId });
    }
  }
  const edges = new Map(
    part.geometries.flatMap((geometry) =>
      (geometry.edges ?? []).map((edge) => [edge.key, edge] as const),
    ),
  );
  return {
    elements,
    elementOrdinalById,
    bodies,
    bodyByElement,
    faces,
    edges,
    nodeCount: Math.floor((part.nodePositions?.length ?? 0) / 3),
  };
}
