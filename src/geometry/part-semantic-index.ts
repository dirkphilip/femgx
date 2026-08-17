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
  /** CSR offsets for authored triangle-face incidence by part-local node id. */
  readonly nodeTriangleFaceOffsets: Uint32Array;
  /** Face ids referenced by the CSR node-incidence ranges above. */
  readonly nodeTriangleFaceIds: Uint32Array;
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
  const nodeCount = Math.floor((part.nodePositions?.length ?? 0) / 3);
  const triangleFaces =
    triangleGeometry?.primitive === "triangles" ? triangleGeometry.faces : undefined;
  const nodeTriangleFaceOffsets =
    triangleFaces === undefined || triangleFaces.length === 0
      ? new Uint32Array(0)
      : new Uint32Array(nodeCount + 1);
  if (triangleFaces !== undefined) {
    for (let faceId = 0; faceId < triangleFaces.length; faceId += 1) {
      const face = triangleFaces[faceId];
      if (face === undefined) continue;
      faces.set(faceIdentity(face.elementId, face.faceIndex), { face, faceId });
      if (nodeCount === 0) continue;
      for (const nodeId of face.nodeIds) {
        const offset = nodeId + 1;
        nodeTriangleFaceOffsets[offset] = (nodeTriangleFaceOffsets[offset] ?? 0) + 1;
      }
    }
  }
  const nodeTriangleFaceIds = buildNodeTriangleFaceIds(
    triangleFaces,
    nodeTriangleFaceOffsets,
    nodeCount,
  );
  const edges = new Map<string, GeometryEdge>();
  for (const geometry of part.geometries) {
    for (const edge of geometry.edges ?? []) {
      // Preserve resolveEdgePickHit's historical first geometry match when
      // independent primitive groups happen to reuse an authored edge key.
      if (!edges.has(edge.key)) edges.set(edge.key, edge);
    }
  }
  return {
    elements,
    elementOrdinalById,
    bodies,
    bodyByElement,
    faces,
    edges,
    nodeCount,
    nodeTriangleFaceOffsets,
    nodeTriangleFaceIds,
  };
}

function buildNodeTriangleFaceIds(
  faces: readonly FaceTessellation[] | undefined,
  offsets: Uint32Array,
  nodeCount: number,
): Uint32Array {
  if (faces === undefined || nodeCount === 0) return new Uint32Array(0);
  for (let nodeId = 1; nodeId < offsets.length; nodeId += 1) {
    offsets[nodeId] = (offsets[nodeId] ?? 0) + (offsets[nodeId - 1] ?? 0);
  }
  const faceIds = new Uint32Array(offsets[nodeCount] ?? 0);
  const cursors = offsets.slice(0, nodeCount);
  for (let faceId = 0; faceId < faces.length; faceId += 1) {
    const face = faces[faceId];
    if (face === undefined) continue;
    for (const nodeId of face.nodeIds) {
      const cursor = cursors[nodeId] ?? 0;
      faceIds[cursor] = faceId;
      cursors[nodeId] = cursor + 1;
    }
  }
  return faceIds;
}
