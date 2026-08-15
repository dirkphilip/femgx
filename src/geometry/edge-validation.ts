import type { ElementId } from "../elements/element";
import { canonicalKey } from "../elements/keys";
import { faceIdentity } from "./element-face-selection";
import type { ElementTessellation, Geometry, GeometryEdge } from "./types";
import { GeometryValidationError } from "./validation-error";

/** Validates stable authored-edge metadata against the part's element identities. */
export function validateEdges(
  geometry: Geometry,
  elements: readonly ElementTessellation[] | undefined,
): void {
  const edges = geometry.edges;
  if (edges === undefined) return;
  const elementIds = new Set((elements ?? []).map((element) => element.id));
  const faceIndicesByElement = new Map<ElementId, Set<number>>();
  for (const face of geometry.primitive === "triangles" ? (geometry.faces ?? []) : []) {
    const indices = faceIndicesByElement.get(face.elementId);
    if (indices === undefined) faceIndicesByElement.set(face.elementId, new Set([face.faceIndex]));
    else indices.add(face.faceIndex);
  }
  const keys = new Set<string>();
  for (const edge of edges) {
    validateEdgeShape(edge);
    if (edge.key !== canonicalKey(edge.nodeIds)) {
      throw new GeometryValidationError(
        "invalid-edge-key",
        `Authored edge key ${edge.key} does not match its node sequence`,
      );
    }
    if (keys.has(edge.key)) {
      throw new GeometryValidationError(
        "duplicate-edge-key",
        `Duplicate authored edge ${edge.key}`,
      );
    }
    keys.add(edge.key);
    validateEdgeElements(edge, elementIds);
    for (const face of edge.faceRefs) {
      if (!faceIndicesByElement.get(face.elementId)?.has(face.faceIndex)) {
        const identity = faceIdentity(face.elementId, face.faceIndex);
        throw new GeometryValidationError(
          "unknown-edge-face",
          `Authored edge ${edge.key} references unknown face ${identity}`,
        );
      }
    }
  }
}

function validateEdgeShape(edge: GeometryEdge): void {
  if (edge.nodeIds.length !== 2 && edge.nodeIds.length !== 3) {
    throw new GeometryValidationError(
      "invalid-edge-node-count",
      `Authored edge ${edge.key} must contain two or three nodes`,
    );
  }
}

function validateEdgeElements(edge: GeometryEdge, elementIds: ReadonlySet<ElementId>): void {
  for (const elementId of edge.incidentElementIds) {
    if (!elementIds.has(elementId)) {
      throw new GeometryValidationError(
        "unknown-edge-element",
        `Authored edge ${edge.key} references unknown element ${elementId}`,
      );
    }
  }
}
