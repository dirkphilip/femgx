import type { ElementId } from "../elements/element";
import { canonicalKey } from "../elements/keys";
import type { Geometry, GeometryEdge } from "./types";
import { GeometryValidationError } from "./validation-error";

/** Validates stable authored-edge metadata against the part's element identities. */
export function validateEdges(geometry: Geometry): void {
  const edges = geometry.edges;
  if (edges === undefined) return;
  const elementIds = new Set((geometry.elements ?? []).map((element) => element.id));
  const faceIds = new Set(
    (geometry.primitive === "triangles" ? (geometry.faces ?? []) : []).map(
      (face) => `${face.elementId}/${face.faceIndex}`,
    ),
  );
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
      if (!faceIds.has(`${face.elementId}/${face.faceIndex}`)) {
        throw new GeometryValidationError(
          "unknown-edge-face",
          `Authored edge ${edge.key} references unknown face ${face.elementId}/${face.faceIndex}`,
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
