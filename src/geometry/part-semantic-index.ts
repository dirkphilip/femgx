import { compareNodeIds } from "../elements/edges";
import type {
  ElementTessellation,
  FaceTessellation,
  GeometryBody,
  GeometryEdge,
  GeometryElementBlock,
} from "./types";
import type { BodyId, Part } from "./part";
import { faceIdentity } from "./element-face-selection";

export { compareNodeIds as compareEdgeNodeIds } from "../elements/edges";

type ElementId = ElementTessellation["id"];
type ElementBlockId = GeometryElementBlock["id"];

interface FaceMetadata {
  readonly face: FaceTessellation;
  readonly faceId: number;
}

interface EdgeMetadata {
  readonly edge: GeometryEdge;
  readonly edgePickId: number;
}

/** Immutable semantic lookups shared by renderer interaction and viewport reconciliation. */
export interface PartSemanticIndex {
  readonly elements: ReadonlyMap<ElementId, ElementTessellation>;
  /** Stable private ordinal (`1..n`) for each authored element id. */
  readonly elementOrdinalById: ReadonlyMap<ElementId, number>;
  readonly bodies: ReadonlyMap<BodyId, GeometryBody>;
  readonly blocks: ReadonlyMap<ElementBlockId, GeometryElementBlock>;
  readonly bodyByElement: ReadonlyMap<ElementId, BodyId>;
  readonly blockByElement: ReadonlyMap<ElementId, ElementBlockId>;
  readonly bodyByBlock: ReadonlyMap<ElementBlockId, BodyId>;
  readonly faces: ReadonlyMap<string, FaceMetadata>;
  readonly edges: ReadonlyMap<string, EdgeMetadata>;
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
  const { elements: partElements = [], bodies: partBodies = [], blocks: partBlocks = [] } = part;
  const elements = new Map(partElements.map((element) => [element.id, element]));
  const elementOrdinalById = new Map(partElements.map((element, index) => [element.id, index + 1]));
  const bodies = new Map(partBodies.map((body) => [body.id, body]));
  const blocks = new Map(partBlocks.map((block) => [block.id, block]));
  const bodyByElement = new Map<ElementId, BodyId>();
  const blockByElement = new Map<ElementId, ElementBlockId>();
  for (const element of partElements) {
    if (element.bodyId !== undefined) bodyByElement.set(element.id, element.bodyId);
    if (element.blockId !== undefined) blockByElement.set(element.id, element.blockId);
  }
  for (const body of partBodies) {
    for (const elementId of body.elementIds) {
      if (!bodyByElement.has(elementId)) bodyByElement.set(elementId, body.id);
    }
  }
  for (const block of partBlocks) {
    for (const elementId of block.elementIds) {
      if (!blockByElement.has(elementId)) blockByElement.set(elementId, block.id);
    }
  }
  const bodyByBlock = new Map<ElementBlockId, BodyId>();
  for (const element of partElements) {
    const blockId = blockByElement.get(element.id);
    const bodyId = bodyByElement.get(element.id);
    if (blockId !== undefined && bodyId !== undefined && !bodyByBlock.has(blockId)) {
      bodyByBlock.set(blockId, bodyId);
    }
  }
  const faces = new Map<string, FaceMetadata>();
  const triangleGeometry = part.geometries.find((geometry) => geometry.primitive === "triangles");
  if (triangleGeometry?.primitive === "triangles") {
    for (const [faceId, face] of (triangleGeometry.faces ?? []).entries()) {
      faces.set(faceIdentity(face.elementId, face.faceIndex), { face, faceId });
    }
  }
  const edges = new Map<string, EdgeMetadata>();
  const authoredEdges = [...part.geometries.flatMap((geometry) => geometry.edges ?? [])].sort(
    (left, right) => compareNodeIds(left.nodeIds, right.nodeIds),
  );
  for (const [edgePickId, edge] of authoredEdges.entries()) {
    edges.set(edge.key, { edge, edgePickId: edgePickId + 1 });
  }
  return {
    elements,
    elementOrdinalById,
    bodies,
    blocks,
    bodyByElement,
    blockByElement,
    bodyByBlock,
    faces,
    edges,
    nodeCount: Math.floor((part.nodePositions?.length ?? 0) / 3),
  };
}
