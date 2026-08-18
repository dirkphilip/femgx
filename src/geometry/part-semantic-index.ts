import type {
  ElementTessellation,
  FaceTessellation,
  GeometryEdge,
  TriangleGeometry,
} from "./types";
import type { BodyId, Part } from "./part";
import { faceIdentity } from "./element-face-selection";
import { packedSemanticStorage } from "./packed/packed-semantic";
import { buildPackedSemanticIndex } from "./packed/packed-semantic-index";
import type { FaceMetadata, PartSemanticIndex } from "./part-semantic-types";

export type { FaceMetadata, PartSemanticIndex, SemanticMap } from "./part-semantic-types";

export { compareNodeIds as compareEdgeNodeIds } from "../elements/edges";

type ElementId = ElementTessellation["id"];

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
  const packed = packedSemanticStorage(part);
  if (packed !== undefined) return buildPackedSemanticIndex(packed);
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
  const visibilityBodyIds = buildVisibilityBodyIds(
    partElements,
    bodyByElement,
    triangleIndex.faces,
  );
  const nonTriangleElementOrdinals =
    triangleIndex.hasBoundaryFaceSubset && triangleIndex.hasCompleteNeighborTriangleIndex
      ? buildNonTriangleElementOrdinals(partElements)
      : new Uint32Array(0);
  const edges = new Map<string, GeometryEdge>();
  for (const geometry of part.geometries) {
    for (const edge of geometry.edges ?? []) {
      if (!edges.has(edge.key)) edges.set(edge.key, edge);
    }
  }
  return {
    elements,
    elementOrdinalById,
    bodies,
    bodyByElement,
    visibilityBodyIds,
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

function buildVisibilityBodyIds(
  elements: readonly ElementTessellation[],
  bodyByElement: ReadonlyMap<ElementId, BodyId>,
  faces: ReadonlyMap<string, FaceMetadata>,
): ReadonlySet<BodyId> {
  const result = new Set<BodyId>();
  for (const element of elements) {
    if (!element.primitiveRanges.some((range) => range.primitive === "triangles")) continue;
    const bodyId = bodyByElement.get(element.id);
    if (bodyId !== undefined) result.add(bodyId);
  }
  for (const { face } of faces.values()) {
    if (face.bodyId !== undefined) result.add(face.bodyId);
    if (face.neighborElementId === undefined) continue;
    const bodyId = bodyByElement.get(face.neighborElementId);
    if (bodyId !== undefined) result.add(bodyId);
  }
  return result;
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
