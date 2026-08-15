import { canonicalEdge, compareNodeIds, edgesOf, type ElementEdge } from "../elements/edges";
import type { Element, ElementId, NodeId } from "../elements/element";
import { facesOfElement, type FaceIdRef } from "../elements/faces";
import { topologyFor } from "../elements/shapes";
import { faceIdentity } from "./element-face-selection";
import type { GeometryEdge } from "./types";

/** Builds validated authored-edge descriptors for element-generated geometry. */
export function authoredEdgesForElements(elements: readonly Element[]): readonly GeometryEdge[] {
  const byKey = new Map<
    string,
    {
      readonly edge: ElementEdge;
      readonly elements: Set<ElementId>;
      readonly faces: Map<string, FaceIdRef>;
    }
  >();
  for (const element of elements) {
    const localEdges = edgesOf(element);
    for (const edge of localEdges) {
      const entry = byKey.get(edge.key);
      if (entry === undefined) {
        byKey.set(edge.key, {
          edge: canonicalEdge(edge),
          elements: new Set([element.id]),
          faces: new Map(),
        });
      } else {
        entry.elements.add(element.id);
      }
    }
    for (const { elementId, faceIndex, face } of facesOfElement(element)) {
      const quadratic = topologyFor(element.shape).order >= 2;
      const localEdgeByKey = new Map(localEdges.map((edge) => [edge.key, edge]));
      for (let index = 0; index < face.nodeIds.length; index += quadratic ? 2 : 1) {
        const nextCorner = quadratic
          ? (index + 2) % face.nodeIds.length
          : (index + 1) % face.nodeIds.length;
        const nodeIds = quadratic
          ? [face.nodeIds[index], face.nodeIds[index + 1], face.nodeIds[nextCorner]]
          : [face.nodeIds[index], face.nodeIds[nextCorner]];
        const localEdge = [...localEdgeByKey.values()].find((edge) =>
          sameEdgeNodes(edge.nodeIds, nodeIds),
        );
        if (localEdge === undefined) continue;
        const entry = byKey.get(localEdge.key);
        entry?.faces.set(faceIdentity(elementId, faceIndex), { elementId, faceIndex });
      }
    }
  }
  return [...byKey.values()]
    .map(({ edge, elements: incidentElementIds, faces }) => ({
      key: edge.key,
      nodeIds: edge.nodeIds,
      incidentElementIds: [...incidentElementIds].sort((a, b) => a - b),
      faceRefs: [...faces.values()].sort(
        (a, b) => a.elementId - b.elementId || a.faceIndex - b.faceIndex,
      ),
    }))
    .sort((a, b) => compareNodeIds(a.nodeIds, b.nodeIds));
}

function sameEdgeNodes(left: readonly NodeId[], right: readonly (NodeId | undefined)[]): boolean {
  if (left.length !== right.length) return false;
  const leftFirst = left[0];
  const leftLast = left[left.length - 1];
  const rightFirst = right[0];
  const rightLast = right[right.length - 1];
  if (
    leftFirst === undefined ||
    leftLast === undefined ||
    rightFirst === undefined ||
    rightLast === undefined
  ) {
    return false;
  }
  const sameDirection = leftFirst === rightFirst && leftLast === rightLast;
  const reverseDirection = leftFirst === rightLast && leftLast === rightFirst;
  if (!sameDirection && !reverseDirection) return false;
  return left.length === 2 || left[1] === right[1];
}
