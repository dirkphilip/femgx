import { canonicalKey } from "../elements/keys";
import { ordinalForId } from "../elements/model-storage";
import { faceIdentity } from "./element-face-selection";
import type { ElementTessellation, GeometryEdge, GeometryInput } from "./types";
import { GeometryValidationError } from "./validation-error";
import { elementOrdinalColumns, facePairIndex, findFace } from "./validation-helpers";

/** Validates stable authored-edge metadata against the part's element identities. */
export function validateEdges(
  geometry: GeometryInput,
  elements: readonly ElementTessellation[] | undefined,
): void {
  const edges = geometry.edges;
  if (edges === undefined) return;
  const elementIndex = elementOrdinalColumns(elements ?? []);
  const faces = geometry.primitive === "triangles" ? (geometry.faces ?? []) : [];
  const faceIndex = facePairIndex(faces);
  const keys = emptyEdgeIndex(edges.length);
  for (let row = 0; row < edges.length; row += 1) {
    const edge = edges[row];
    if (edge === undefined) throw new Error(`Part has no edge ${row}`);
    validateEdgeShape(edge);
    if (edge.key !== canonicalKey(edge.nodeIds)) {
      throw new GeometryValidationError(
        "invalid-edge-key",
        `Authored edge key ${edge.key} does not match its node sequence`,
      );
    }
    if (hasEdge(keys, edges, edge)) {
      throw new GeometryValidationError(
        "duplicate-edge-key",
        `Duplicate authored edge ${edge.key}`,
      );
    }
    addEdge(keys, row, edge);
    validateEdgeElements(edge, elementIndex);
    for (const face of edge.faceRefs) {
      if (findFace(faces, faceIndex, face.elementId, face.faceIndex) === undefined) {
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

function validateEdgeElements(
  edge: GeometryEdge,
  elementIndex: { readonly ids: Uint32Array; readonly ordinals: Uint32Array },
): void {
  for (const elementId of edge.incidentElementIds) {
    if (ordinalForId(elementIndex.ids, elementIndex.ordinals, elementId) === undefined) {
      throw new GeometryValidationError(
        "unknown-edge-element",
        `Authored edge ${edge.key} references unknown element ${elementId}`,
      );
    }
  }
}

interface EdgeIndex {
  readonly heads: Int32Array;
  readonly next: Int32Array;
}

function emptyEdgeIndex(count: number): EdgeIndex {
  let capacity = 1;
  while (capacity < Math.max(1, Math.ceil(count / 0.7))) capacity *= 2;
  return { heads: new Int32Array(capacity).fill(-1), next: new Int32Array(count).fill(-1) };
}

function addEdge(index: EdgeIndex, row: number, edge: GeometryEdge): void {
  const slot = edgeHash(edge) & (index.heads.length - 1);
  index.next[row] = index.heads[slot] ?? -1;
  index.heads[slot] = row;
}

function hasEdge(index: EdgeIndex, edges: readonly GeometryEdge[], edge: GeometryEdge): boolean {
  for (
    let row = index.heads[edgeHash(edge) & (index.heads.length - 1)] ?? -1;
    row !== -1;
    row = index.next[row] ?? -1
  ) {
    const candidate = edges[row];
    if (candidate !== undefined && sameCanonicalNodes(candidate.nodeIds, edge.nodeIds)) return true;
  }
  return false;
}

function edgeHash(edge: GeometryEdge): number {
  const [first, second, third] = canonicalNodes(edge.nodeIds);
  let hash = Math.imul(2_166_136_261 ^ (first >>> 0), 16_777_619) >>> 0;
  if (third !== undefined) hash = Math.imul(hash ^ (second >>> 0), 16_777_619) >>> 0;
  return Math.imul(hash ^ ((third ?? second) >>> 0), 16_777_619) >>> 0;
}

function sameCanonicalNodes(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const [leftFirst, leftSecond, leftThird] = canonicalNodes(left);
  const [rightFirst, rightSecond, rightThird] = canonicalNodes(right);
  return leftFirst === rightFirst && leftSecond === rightSecond && leftThird === rightThird;
}

function canonicalNodes(ids: readonly number[]): [number, number, number | undefined] {
  const first = ids[0] ?? 0;
  const second = ids[1] ?? 0;
  const third = ids[2];
  if (third === undefined)
    return first <= second ? [first, second, undefined] : [second, first, undefined];
  const low = Math.min(first, second, third);
  const high = Math.max(first, second, third);
  return [low, first + second + third - low - high, high];
}
