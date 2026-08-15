import { canonicalEdge, compareNodeIds, edgesOf } from "../elements/edges";
import type { Element, ElementId, NodeId } from "../elements/element";
import { facesOfElement, type FaceIdRef } from "../elements/faces";
import { canonicalKey } from "../elements/keys";
import { topologyFor } from "../elements/shapes";
import { faceIdentity } from "./element-face-selection";
import type { GeometryEdge } from "./types";

/** Builds validated authored-edge descriptors for element-generated geometry. */
export function authoredEdgesForElements(elements: readonly Element[]): readonly GeometryEdge[] {
  const occurrences: AuthoredEdgeOccurrence[] = [];
  for (const element of elements) {
    const localEdges = edgesOf(element);
    const facesByEdge = new Map<string, FaceIdRef[]>();
    for (const { elementId, faceIndex, face } of facesOfElement(element)) {
      const quadratic = topologyFor(element.shape).order >= 2;
      for (let index = 0; index < face.nodeIds.length; index += quadratic ? 2 : 1) {
        const nextCorner = quadratic
          ? (index + 2) % face.nodeIds.length
          : (index + 1) % face.nodeIds.length;
        const nodeIds = quadratic
          ? [face.nodeIds[index], face.nodeIds[index + 1], face.nodeIds[nextCorner]]
          : [face.nodeIds[index], face.nodeIds[nextCorner]];
        const localEdge = localEdges.find((edge) => sameEdgeNodes(edge.nodeIds, nodeIds));
        if (localEdge === undefined) continue;
        const refs = facesByEdge.get(localEdge.key) ?? [];
        refs.push({ elementId, faceIndex });
        facesByEdge.set(localEdge.key, refs);
      }
    }
    for (const edge of localEdges) {
      occurrences.push({
        nodeIds: edge.nodeIds,
        elementId: element.id,
        faceRefs: facesByEdge.get(edge.key) ?? [],
      });
    }
  }
  return mergeAuthoredEdges(occurrences);
}

/** One authored edge incidence before shared topology is deduplicated. */
export interface AuthoredEdgeOccurrence {
  readonly nodeIds: readonly NodeId[];
  readonly elementId: ElementId;
  readonly faceRefs?: readonly FaceIdRef[];
}

/** Merges edge incidences into deterministic part geometry metadata. */
export function mergeAuthoredEdges(
  occurrences: readonly AuthoredEdgeOccurrence[],
): readonly GeometryEdge[] {
  const byKey = new Map<
    string,
    { edge: GeometryEdge; elements: Set<ElementId>; faces: Map<string, FaceIdRef> }
  >();
  for (const occurrence of occurrences) {
    const edge = canonicalEdge({
      key: canonicalKey(occurrence.nodeIds),
      nodeIds: occurrence.nodeIds,
    });
    const entry = byKey.get(edge.key) ?? {
      edge: { key: edge.key, nodeIds: edge.nodeIds, incidentElementIds: [], faceRefs: [] },
      elements: new Set<ElementId>(),
      faces: new Map<string, FaceIdRef>(),
    };
    entry.elements.add(occurrence.elementId);
    for (const face of occurrence.faceRefs ?? []) {
      entry.faces.set(faceIdentity(face.elementId, face.faceIndex), face);
    }
    byKey.set(edge.key, entry);
  }
  return [...byKey.values()]
    .map(({ edge, elements, faces }) => ({
      key: edge.key,
      nodeIds: edge.nodeIds,
      incidentElementIds: [...elements].sort((a, b) => a - b),
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
