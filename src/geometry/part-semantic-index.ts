import type {
  ElementTessellation,
  FaceTessellation,
  GeometryBody,
  GeometryEdge,
  TriangleGeometry,
} from "./types";
import type { BodyId, Part } from "./part";
import { faceIdentity } from "./element-face-selection";

export { compareNodeIds as compareEdgeNodeIds } from "../elements/edges";

type ElementId = ElementTessellation["id"];

interface FaceMetadata {
  readonly face: FaceTessellation;
  readonly faceId: number;
}

interface TriangleSemanticIndex {
  readonly faces: Map<string, FaceMetadata>;
  readonly nodeCount: number;
  readonly nodeTriangleFaceOffsets: Uint32Array;
  readonly nodeTriangleFaceIds: Uint32Array;
  readonly neighborTriangleFaceOffsets: Uint32Array;
  readonly neighborTriangleFaceIds: Uint32Array;
  readonly hasBoundaryFaceSubset: boolean;
  readonly hasCompleteNeighborTriangleIndex: boolean;
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
  /** CSR offsets for authored triangle faces grouped by their neighbor element. */
  readonly neighborTriangleFaceOffsets: Uint32Array;
  /** Authored face ids in the neighbor-element CSR ranges above. */
  readonly neighborTriangleFaceIds: Uint32Array;
  /** Private ordinals for elements that own any non-triangle primitive range. */
  readonly nonTriangleElementOrdinals: Uint32Array;
  /** Whether the declared triangle subset contains only exterior faces. */
  readonly hasBoundaryFaceSubset: boolean;
  /** Whether every authored triangle neighbor resolves to a local element. */
  readonly hasCompleteNeighborTriangleIndex: boolean;
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
  const triangleIndex = buildTriangleSemanticIndex(part, partElements, elementOrdinalById);
  const nonTriangleElementOrdinals =
    triangleIndex.hasBoundaryFaceSubset && triangleIndex.hasCompleteNeighborTriangleIndex
      ? buildNonTriangleElementOrdinals(partElements)
      : new Uint32Array(0);
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
    faces: triangleIndex.faces,
    edges,
    nodeCount: triangleIndex.nodeCount,
    nodeTriangleFaceOffsets: triangleIndex.nodeTriangleFaceOffsets,
    nodeTriangleFaceIds: triangleIndex.nodeTriangleFaceIds,
    neighborTriangleFaceOffsets: triangleIndex.neighborTriangleFaceOffsets,
    neighborTriangleFaceIds: triangleIndex.neighborTriangleFaceIds,
    nonTriangleElementOrdinals,
    hasBoundaryFaceSubset: triangleIndex.hasBoundaryFaceSubset,
    hasCompleteNeighborTriangleIndex: triangleIndex.hasCompleteNeighborTriangleIndex,
  };
}

function buildTriangleSemanticIndex(
  part: Part,
  partElements: readonly ElementTessellation[],
  elementOrdinalById: ReadonlyMap<ElementId, number>,
): TriangleSemanticIndex {
  const faces = new Map<string, FaceMetadata>();
  const triangleGeometry = part.geometries.find((geometry) => geometry.primitive === "triangles");
  const nodeCount = Math.floor((part.nodePositions?.length ?? 0) / 3);
  const triangleFaces =
    triangleGeometry?.primitive === "triangles" ? triangleGeometry.faces : undefined;
  const nodeTriangleFaceOffsets =
    triangleFaces === undefined || triangleFaces.length === 0
      ? new Uint32Array(0)
      : new Uint32Array(nodeCount + 1);
  collectTriangleFaceMetadata(triangleFaces, nodeCount, faces, nodeTriangleFaceOffsets);
  const hasBoundaryFaceSubset = hasBoundaryTriangleSubset(triangleGeometry, faces);
  const neighborTriangleFaceOffsets =
    !hasBoundaryFaceSubset || triangleFaces === undefined || partElements.length === 0
      ? new Uint32Array(0)
      : new Uint32Array(partElements.length + 1);
  const hasCompleteNeighborTriangleIndex =
    neighborTriangleFaceOffsets.length === 0 ||
    collectNeighborFaceCounts(triangleFaces ?? [], elementOrdinalById, neighborTriangleFaceOffsets);
  const usableNeighborFaceOffsets = hasCompleteNeighborTriangleIndex
    ? neighborTriangleFaceOffsets
    : new Uint32Array(0);
  const { nodeTriangleFaceIds, neighborTriangleFaceIds } = buildTriangleFaceIds(
    triangleFaces,
    elementOrdinalById,
    usableNeighborFaceOffsets,
    nodeTriangleFaceOffsets,
    nodeCount,
  );
  return {
    faces,
    nodeCount,
    nodeTriangleFaceOffsets,
    nodeTriangleFaceIds,
    neighborTriangleFaceOffsets: usableNeighborFaceOffsets,
    neighborTriangleFaceIds,
    hasBoundaryFaceSubset,
    hasCompleteNeighborTriangleIndex,
  };
}

function collectTriangleFaceMetadata(
  triangleFaces: readonly FaceTessellation[] | undefined,
  nodeCount: number,
  faces: Map<string, FaceMetadata>,
  nodeOffsets: Uint32Array,
): void {
  for (let faceId = 0; faceId < (triangleFaces?.length ?? 0); faceId += 1) {
    const face = triangleFaces?.[faceId];
    if (face === undefined) continue;
    faces.set(faceIdentity(face.elementId, face.faceIndex), { face, faceId });
    if (nodeCount > 0) {
      for (const nodeId of face.nodeIds) {
        const offset = nodeId + 1;
        nodeOffsets[offset] = (nodeOffsets[offset] ?? 0) + 1;
      }
    }
  }
}

function collectNeighborFaceCounts(
  triangleFaces: readonly FaceTessellation[],
  elementOrdinalById: ReadonlyMap<ElementId, number>,
  neighborOffsets: Uint32Array,
): boolean {
  for (const face of triangleFaces) {
    const ordinal =
      face.neighborElementId === undefined
        ? undefined
        : elementOrdinalById.get(face.neighborElementId);
    if (ordinal === undefined && face.neighborElementId !== undefined) return false;
    if (ordinal !== undefined) neighborOffsets[ordinal] = (neighborOffsets[ordinal] ?? 0) + 1;
  }
  return true;
}

function buildNonTriangleElementOrdinals(elements: readonly ElementTessellation[]): Uint32Array {
  const ordinals: number[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    if (elements[index]?.primitiveRanges.some((range) => range.primitive !== "triangles")) {
      ordinals.push(index + 1);
    }
  }
  return Uint32Array.from(ordinals);
}

function buildTriangleFaceIds(
  faces: readonly FaceTessellation[] | undefined,
  elementOrdinals: ReadonlyMap<ElementId, number>,
  neighborOffsets: Uint32Array,
  nodeOffsets: Uint32Array,
  nodeCount: number,
): { readonly nodeTriangleFaceIds: Uint32Array; readonly neighborTriangleFaceIds: Uint32Array } {
  if (faces === undefined) {
    return { nodeTriangleFaceIds: new Uint32Array(0), neighborTriangleFaceIds: new Uint32Array(0) };
  }
  for (let index = 1; index < nodeOffsets.length; index += 1) {
    nodeOffsets[index] = (nodeOffsets[index] ?? 0) + (nodeOffsets[index - 1] ?? 0);
  }
  if (neighborOffsets.length > 0) {
    for (let index = 1; index < neighborOffsets.length; index += 1) {
      neighborOffsets[index] = (neighborOffsets[index] ?? 0) + (neighborOffsets[index - 1] ?? 0);
    }
  }
  const nodeFaceIds = new Uint32Array(nodeOffsets[nodeCount] ?? 0);
  const neighborFaceIds = new Uint32Array(neighborOffsets[neighborOffsets.length - 1] ?? 0);
  const nodeCursors = nodeOffsets.slice(0, nodeCount);
  const neighborCursors = neighborOffsets.length > 0 ? neighborOffsets.slice(0, -1) : undefined;
  for (let faceId = 0; faceId < faces.length; faceId += 1) {
    const face = faces[faceId];
    if (face === undefined) continue;
    if (nodeCount > 0) {
      for (const nodeId of face.nodeIds) {
        const cursor = nodeCursors[nodeId] ?? 0;
        nodeFaceIds[cursor] = faceId;
        nodeCursors[nodeId] = cursor + 1;
      }
    }
    if (neighborCursors !== undefined) {
      const neighborElementId = face.neighborElementId;
      const ordinal =
        neighborElementId === undefined ? undefined : elementOrdinals.get(neighborElementId);
      if (ordinal !== undefined) {
        const cursor = neighborCursors[ordinal - 1] ?? 0;
        neighborFaceIds[cursor] = faceId;
        neighborCursors[ordinal - 1] = cursor + 1;
      }
    }
  }
  return { nodeTriangleFaceIds: nodeFaceIds, neighborTriangleFaceIds: neighborFaceIds };
}

function hasBoundaryTriangleSubset(
  triangles: TriangleGeometry | undefined,
  faces: ReadonlyMap<string, FaceMetadata>,
): boolean {
  const subset = triangles?.faceSubset;
  return (
    subset !== undefined &&
    subset.faceIds.every(({ elementId, faceIndex }) => {
      const face = faces.get(faceIdentity(elementId, faceIndex))?.face;
      return face !== undefined && face.neighborElementId === undefined;
    })
  );
}
