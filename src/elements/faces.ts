/**
 * Extraction of element faces as oriented polygon loops.
 *
 * Volume shapes (tet/wedge/pyramid/hex) have a fixed set of faces in the
 * canonical convention, listed as corner loops whose right-hand-rule winding gives an
 * outward normal for a right-handed (positive-Jacobian) element. Quadratic
 * shapes expand each face with its mid-edge nodes, interleaving corners and
 * mid-edge nodes around the loop, so coincident faces share one canonical
 * identity across elements. Point and line elements have no faces. A linear
 * triangle or quad exposes its complete surface as one oriented face.
 */

import type { Element, ElementId, NodeId } from "./element";
import type { ElementModel } from "./model";
import { elementModelIdAt, elementModelNodeIdAt, elementModelTopologyAt } from "./model-topology";
import { topologyFor, type ElementFamily, type ElementTopology } from "./shapes";
import { at } from "./indices";
import { canonicalKey } from "./keys";

/**
 * Deterministic canonical identity of a face, independent of orientation.
 * @category Elements and model editing
 */
export type FaceKey = string;

/**
 * An oriented face of an element as a polygon loop of node ids.
 * @category Elements and model editing
 */
export interface ElementFace {
  /** Canonical identity shared by coincident faces (sorted node ids). */
  readonly key: FaceKey;
  /** Outward-oriented node loop; interleaves mid-edge nodes when quadratic. */
  readonly nodeIds: readonly NodeId[];
}

/**
 * Stable identity of one oriented face of an element.
 * @category Elements and model editing
 */
export interface FaceIdRef {
  /** Authored element owning the face. */
  readonly elementId: ElementId;
  /** Index of the face within the element's canonical face list. */
  readonly faceIndex: number;
}

/**
 * Machine-readable validation failure for an explicit element-face subset.
 * @category Elements and model editing
 */
export type FaceSelectionErrorCode = "invalid-element-id" | "invalid-face-index" | "duplicate-face";

/**
 * Typed error raised when a face subset does not resolve to model topology.
 * @category Elements and model editing
 */
export class FaceSelectionError extends Error {
  /** Machine-readable face-selection validation code. */
  readonly code: FaceSelectionErrorCode;

  constructor(code: FaceSelectionErrorCode, message: string) {
    super(message);
    this.name = "FaceSelectionError";
    this.code = code;
  }
}

/**
 * An element face together with its stable identity.
 * @category Elements and model editing
 */
export interface ElementFaceRef extends FaceIdRef {
  /** Oriented face topology. */
  readonly face: ElementFace;
}

/**
 * Returns the element's faces paired with their stable `faceIndex`.
 * @category Elements and model editing
 */
export function faceRefsOf(element: Element): readonly ElementFaceRef[] {
  return facesOf(element).map((face, faceIndex) => ({
    elementId: element.id,
    faceIndex,
    face,
  }));
}

/**
 * A face together with how it is shared across a mesh.
 * @category Elements and model editing
 */
export interface ClassifiedFace {
  /** One element incident to the face. */
  readonly elementId: ElementId;
  /** Canonical identity shared by coincident faces. */
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

const WEDGE_FACES: ReadonlyArray<readonly number[]> = [
  [0, 2, 1],
  [3, 4, 5],
  [0, 1, 4, 3],
  [1, 2, 5, 4],
  [2, 0, 3, 5],
];

const PYRAMID_FACES: ReadonlyArray<readonly number[]> = [
  [0, 3, 2, 1],
  [0, 1, 4],
  [1, 2, 4],
  [2, 3, 4],
  [3, 0, 4],
];

const HEX_FACES: ReadonlyArray<readonly number[]> = [
  [0, 4, 7, 3],
  [1, 2, 6, 5],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 3, 2, 1],
  [4, 5, 6, 7],
];

/** Returns canonical face corner-index loops for internal direct topology compilers. */
export function faceCornerLoops(family: ElementFamily): ReadonlyArray<readonly number[]> {
  switch (family) {
    case "triangle":
      return [[0, 1, 2]];
    case "quad":
      return [[0, 1, 2, 3]];
    case "tet":
      return TET_FACES;
    case "wedge":
      return WEDGE_FACES;
    case "pyramid":
      return PYRAMID_FACES;
    case "hex":
      return HEX_FACES;
    case "line":
    case "point":
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

/**
 * Returns the oriented faces of a single element, in canonical order.
 * @category Elements and model editing
 */
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
 * @category Elements and model editing
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

/**
 * Returns stable element-face identities for the exterior of a mesh.
 * @category Elements and model editing
 */
export function boundaryFaceRefs(elements: readonly Element[]): readonly FaceIdRef[] {
  const candidates = new Map<FaceKey, FaceIdRef | undefined>();
  for (const element of elements) {
    for (const [faceIndex, face] of facesOf(element).entries()) {
      if (candidates.has(face.key)) {
        candidates.set(face.key, undefined);
      } else {
        candidates.set(face.key, { elementId: element.id, faceIndex });
      }
    }
  }
  return [...candidates.values()].filter((ref): ref is FaceIdRef => ref !== undefined);
}

/**
 * Extracts boundary faces from dense model columns without materializing every
 * `Element` or using a model-sized string-key map. Returned references are the
 * requested boundary result; all intermediate topology is typed and ephemeral.
 */
export function boundaryFaceRefsForModel(model: ElementModel): readonly FaceIdRef[] {
  const sizes = modelFaceSizes(model);
  const columns: ModelFaceColumns = {
    elementIds: new Uint32Array(sizes.faces),
    faceIndices: new Uint32Array(sizes.faces),
    offsets: new Uint32Array(sizes.faces + 1),
    nodes: new Uint32Array(sizes.nodes),
  };
  fillModelFaces(model, columns);
  const order = sortModelFaceRows(columns.offsets, columns.nodes);
  const boundary = boundaryModelFaceRows(order, columns.offsets, columns.nodes);
  const count = boundaryFaceCount(boundary);
  const result = new Array<FaceIdRef>(count);
  writeBoundaryFaceRefs(result, boundary, columns);
  return result;
}

interface ModelFaceColumns {
  readonly elementIds: Uint32Array;
  readonly faceIndices: Uint32Array;
  readonly offsets: Uint32Array;
  readonly nodes: Uint32Array;
}

function modelFaceSizes(model: ElementModel): { readonly faces: number; readonly nodes: number } {
  let faces = 0;
  let nodes = 0;
  for (let ordinal = 0; ordinal < model.elementIds.length; ordinal += 1) {
    const topology = elementModelTopologyAt(model, ordinal);
    const loops = faceCornerLoops(topology.family);
    faces += loops.length;
    for (let face = 0; face < loops.length; face += 1) {
      nodes += (loops[face]?.length ?? 0) * (topology.order >= 2 ? 2 : 1);
    }
  }
  return { faces, nodes };
}

function fillModelFaces(model: ElementModel, columns: ModelFaceColumns): void {
  const { elementIds, faceIndices, offsets, nodes } = columns;
  let faceOutput = 0;
  let nodeOutput = 0;
  for (let ordinal = 0; ordinal < model.elementIds.length; ordinal += 1) {
    const topology = elementModelTopologyAt(model, ordinal);
    const loops = faceCornerLoops(topology.family);
    const id = elementModelIdAt(model, ordinal);
    for (let face = 0; face < loops.length; face += 1) {
      const loop = loops[face];
      if (loop === undefined) throw new Error("Element topology has no face");
      elementIds[faceOutput] = id;
      faceIndices[faceOutput] = face;
      offsets[faceOutput] = nodeOutput;
      nodeOutput = writeCanonicalModelFace(nodes, nodeOutput, { model, ordinal, topology, loop });
      faceOutput += 1;
    }
  }
  offsets[faceOutput] = nodeOutput;
}

function writeCanonicalModelFace(
  target: Uint32Array,
  offset: number,
  input: {
    readonly model: ElementModel;
    readonly ordinal: number;
    readonly topology: ElementTopology;
    readonly loop: readonly number[];
  },
): number {
  const { model, ordinal, topology, loop } = input;
  const stride = topology.order >= 2 ? 2 : 1;
  for (let index = 0; index < loop.length; index += 1) {
    const corner = loop[index];
    const next = loop[(index + 1) % loop.length];
    if (corner === undefined || next === undefined) throw new Error("Element face has no corner");
    target[offset + index * stride] = elementModelNodeIdAt(model, ordinal, corner);
    if (stride === 2) {
      const middle = topology.edgeNodes[modelFaceEdgeIndex(topology, corner, next)];
      if (middle === undefined) throw new Error("Quadratic face has no mid-edge node");
      target[offset + index * stride + 1] = elementModelNodeIdAt(model, ordinal, middle);
    }
  }
  sortModelFaceRange(target, offset, loop.length * stride);
  return offset + loop.length * stride;
}

function modelFaceEdgeIndex(topology: ElementTopology, first: number, last: number): number {
  for (let index = 0; index < topology.edges.length; index += 1) {
    const edge = topology.edges[index];
    if (
      edge !== undefined &&
      ((edge[0] === first && edge[1] === last) || (edge[0] === last && edge[1] === first))
    ) {
      return index;
    }
  }
  throw new Error(`Face edge ${first}-${last} is not a topology edge`);
}

function sortModelFaceRange(values: Uint32Array, start: number, count: number): void {
  for (let index = start + 1; index < start + count; index += 1) {
    const value = values[index] ?? 0;
    let cursor = index;
    while (cursor > start && (values[cursor - 1] ?? 0) > value) {
      values[cursor] = values[cursor - 1] ?? 0;
      cursor -= 1;
    }
    values[cursor] = value;
  }
}

function sortModelFaceRows(offsets: Uint32Array, nodes: Uint32Array): Uint32Array {
  const result = new Uint32Array(offsets.length - 1);
  const scratch = new Uint32Array(result.length);
  for (let index = 0; index < result.length; index += 1) result[index] = index;
  for (let width = 1; width < result.length; width *= 2) {
    for (let start = 0; start < result.length; start += width * 2) {
      const middle = Math.min(start + width, result.length);
      const end = Math.min(start + width * 2, result.length);
      mergeModelFaceRows(offsets, nodes, result, scratch, { start, middle, end });
    }
    result.set(scratch);
  }
  return result;
}

function mergeModelFaceRows(
  offsets: Uint32Array,
  nodes: Uint32Array,
  source: Uint32Array,
  target: Uint32Array,
  range: { readonly start: number; readonly middle: number; readonly end: number },
): void {
  const { start, middle, end } = range;
  let left = start;
  let right = middle;
  for (let output = start; output < end; output += 1) {
    const leftRow = source[left] ?? 0;
    const rightRow = source[right] ?? 0;
    if (
      left < middle &&
      (right >= end || compareModelFaceRows(offsets, nodes, leftRow, rightRow) <= 0)
    ) {
      target[output] = leftRow;
      left += 1;
    } else {
      target[output] = rightRow;
      right += 1;
    }
  }
}

function compareModelFaceRows(
  offsets: Uint32Array,
  nodes: Uint32Array,
  left: number,
  right: number,
): number {
  const leftStart = offsets[left] ?? 0;
  const leftEnd = offsets[left + 1] ?? leftStart;
  const rightStart = offsets[right] ?? 0;
  const rightEnd = offsets[right + 1] ?? rightStart;
  const shared = Math.min(leftEnd - leftStart, rightEnd - rightStart);
  for (let offset = 0; offset < shared; offset += 1) {
    const difference = (nodes[leftStart + offset] ?? 0) - (nodes[rightStart + offset] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftEnd - leftStart - (rightEnd - rightStart);
}

function boundaryModelFaceRows(
  order: Uint32Array,
  offsets: Uint32Array,
  nodes: Uint32Array,
): Uint8Array {
  const result = new Uint8Array(order.length);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (
      end < order.length &&
      compareModelFaceRows(offsets, nodes, order[start] ?? 0, order[end] ?? 0) === 0
    )
      end += 1;
    if (end - start === 1) result[order[start] ?? 0] = 1;
    start = end;
  }
  return result;
}

function boundaryFaceCount(rows: Uint8Array): number {
  let count = 0;
  for (let row = 0; row < rows.length; row += 1) count += rows[row] ?? 0;
  return count;
}

function writeBoundaryFaceRefs(
  target: FaceIdRef[],
  boundary: Uint8Array,
  columns: ModelFaceColumns,
): void {
  const { elementIds, faceIndices } = columns;
  let output = 0;
  for (let row = 0; row < boundary.length; row += 1) {
    if (boundary[row] === 1) {
      target[output++] = { elementId: elementIds[row] ?? 0, faceIndex: faceIndices[row] ?? 0 };
    }
  }
}
