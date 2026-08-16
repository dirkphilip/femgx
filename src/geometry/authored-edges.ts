import { canonicalEdge, compareNodeIds, edgesOf } from "../elements/edges";
import type { Element, ElementId, NodeId } from "../elements/element";
import { facesOfElement, type FaceIdRef } from "../elements/faces";
import { canonicalKey } from "../elements/keys";
import { topologyFor, type ElementTopology } from "../elements/shapes";
import { faceIdentity } from "./element-face-selection";
import type { GeometryEdge } from "./types";

/** Builds validated authored-edge descriptors for element-generated geometry. */
export function authoredEdgesForElements(elements: readonly Element[]): readonly GeometryEdge[] {
  return mergeAuthoredEdges(
    elements.flatMap((element) => {
      const faceIndices = edgeFaceIndices(element, topologyFor(element.shape));
      return edgesOf(element).map((edge, edgeIndex) => ({
        nodeIds: edge.nodeIds,
        elementId: element.id,
        faceRefs: (faceIndices[edgeIndex] ?? []).map((faceIndex) => ({
          elementId: element.id,
          faceIndex,
        })),
      }));
    }),
  );
}

const edgeFacesByTopology = new WeakMap<ElementTopology, readonly (readonly number[])[]>();

function edgeFaceIndices(
  element: Element,
  topology: ElementTopology,
): readonly (readonly number[])[] {
  const cached = edgeFacesByTopology.get(topology);
  if (cached !== undefined) return cached;
  const faces = facesOfElement(element);
  const faceIndices = edgesOf(element).map((edge) =>
    faces.flatMap(({ face, faceIndex }) =>
      edge.nodeIds.every((nodeId) => face.nodeIds.includes(nodeId)) ? [faceIndex] : [],
    ),
  );
  edgeFacesByTopology.set(topology, faceIndices);
  return faceIndices;
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
