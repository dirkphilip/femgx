/**
 * Extraction of element faces as oriented polygon loops.
 *
 * Volume shapes (tet/hex) have a fixed set of faces taken from the VTK
 * convention, listed as corner loops whose right-hand-rule winding gives an
 * outward normal for a right-handed (positive-Jacobian) element. Quadratic
 * shapes expand each face with its mid-edge nodes, interleaving corners and
 * mid-edge nodes around the loop, so coincident faces share one canonical
 * identity across elements. Point and line elements have no faces.
 */

import type { Element, ElementId, NodeId } from "./element";
import { topologyFor, type ElementFamily, type ElementTopology } from "./shapes";
import { at } from "./indices";
import { canonicalKey } from "./keys";

/** Deterministic canonical identity of a face, independent of orientation. */
export type FaceKey = string;

/** An oriented face of an element as a polygon loop of node ids. */
export interface ElementFace {
  /** Canonical identity shared by coincident faces (sorted node ids). */
  readonly key: FaceKey;
  /** Outward-oriented node loop; interleaves mid-edge nodes when quadratic. */
  readonly nodeIds: readonly NodeId[];
}

/** Stable identity of one oriented face of an element. */
export interface FaceIdRef {
  readonly elementId: ElementId;
  /** Index of the face within the element's canonical face list. */
  readonly faceIndex: number;
}

/** An element face together with its stable identity. */
export interface ElementFaceRef extends FaceIdRef {
  readonly face: ElementFace;
}

/** Returns the element's faces paired with their stable `faceIndex`. */
export function facesOfElement(element: Element): readonly ElementFaceRef[] {
  return facesOf(element).map((face, faceIndex) => ({
    elementId: element.id,
    faceIndex,
    face,
  }));
}

/** A face together with how it is shared across a mesh. */
export interface ClassifiedFace {
  readonly elementId: ElementId;
  readonly key: FaceKey;
  /** The oriented loop for this element's copy of the face. */
  readonly nodeIds: readonly NodeId[];
  /** Number of elements incident to this face (1 boundary, 2 interior). */
  readonly count: number;
  /** True when the face is shared by exactly one element (mesh boundary). */
  readonly boundary: boolean;
}

const TET_FACES: ReadonlyArray<readonly number[]> = [
  [0, 1, 3],
  [1, 2, 3],
  [2, 0, 3],
  [0, 2, 1],
];

const HEX_FACES: ReadonlyArray<readonly number[]> = [
  [0, 4, 7, 3],
  [1, 2, 6, 5],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 3, 2, 1],
  [4, 5, 6, 7],
];

function faceCornerLoops(family: ElementFamily): ReadonlyArray<readonly number[]> {
  switch (family) {
    case "tet":
      return TET_FACES;
    case "hex":
      return HEX_FACES;
    default:
      return [];
  }
}

function cornerPairs(corners: readonly number[]): ReadonlyArray<readonly [number, number]> {
  return corners.map(
    (corner, index) => [corner, at(corners, (index + 1) % corners.length)] as const,
  );
}

function midEdgeNode(
  topology: ElementTopology,
  nodeIds: readonly NodeId[],
  cornerA: number,
  cornerB: number,
): NodeId {
  const edgeIndex = topology.edges.findIndex(
    ([a, b]) => (a === cornerA && b === cornerB) || (a === cornerB && b === cornerA),
  );
  if (edgeIndex < 0) {
    throw new Error(`Face edge ${cornerA}-${cornerB} is not a topology edge`);
  }
  return at(nodeIds, at(topology.edgeNodes, edgeIndex));
}

function expandLoop(
  topology: ElementTopology,
  nodeIds: readonly NodeId[],
  corners: readonly number[],
): readonly NodeId[] {
  const loop: NodeId[] = [];
  for (const [corner, next] of cornerPairs(corners)) {
    loop.push(at(nodeIds, corner));
    if (topology.order >= 2) {
      loop.push(midEdgeNode(topology, nodeIds, corner, next));
    }
  }
  return loop;
}

/** Returns the oriented faces of a single element, in canonical order. */
export function facesOf(element: Element): readonly ElementFace[] {
  const topology = topologyFor(element.shape);
  return faceCornerLoops(topology.family).map((corners) => {
    const nodeIds = expandLoop(topology, element.nodeIds, corners);
    return { key: canonicalKey(nodeIds), nodeIds };
  });
}

/**
 * Classifies every face of a mesh, deduplicating coincident faces by their
 * canonical key and flagging boundary faces (shared by exactly one element).
 */
export function classifyFaces(elements: readonly Element[]): readonly ClassifiedFace[] {
  const facesByElement = elements.map((element) => ({ element, faces: facesOf(element) }));
  const counts = new Map<FaceKey, number>();
  for (const { faces } of facesByElement) {
    for (const face of faces) {
      counts.set(face.key, (counts.get(face.key) ?? 0) + 1);
    }
  }
  const classified: ClassifiedFace[] = [];
  for (const { element, faces } of facesByElement) {
    for (const face of faces) {
      const count = counts.get(face.key);
      classified.push({
        elementId: element.id,
        key: face.key,
        nodeIds: face.nodeIds,
        count: count ?? 0,
        boundary: count === 1,
      });
    }
  }
  return classified;
}
