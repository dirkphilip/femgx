import { validateOneBasedId } from "./id-validation";
import { ordinalForId, sortedOrdinals } from "../elements/model-storage";
import { faceIdentity } from "./element-face-selection";
import { geometrySemanticGraph } from "./semantic/part-semantic-graph";
import {
  addTypedPair,
  createTypedPairIndex,
  findTypedPair,
  type TypedPairIndex,
} from "./semantic/typed-pair-index";
import type {
  ElementTessellation,
  FaceTessellation,
  GeometryInput,
  TriangleGeometry,
} from "./types";

const faceSubsetMasks = new WeakMap<TriangleGeometry, Uint8Array>();

/** Returns the cached displayed-primitive mask for a geometry's face subset. */
export function faceSubsetPrimitiveMask(geometry: TriangleGeometry): Uint8Array | undefined {
  const subset = geometry.faceSubset;
  if (subset === undefined) return undefined;
  const cached = faceSubsetMasks.get(geometry);
  if (cached !== undefined) return cached;
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    const { graph, geometryOrdinal } = semantic;
    if ((graph.faceSubsetDefined[geometryOrdinal] ?? 0) !== 1) return undefined;
    const displayedByPrimitive = new Uint8Array(Math.floor(geometry.indices.length / 3));
    const first = graph.faceSubsetOffsets[geometryOrdinal] ?? 0;
    const last = graph.faceSubsetOffsets[geometryOrdinal + 1] ?? first;
    for (let row = first; row < last; row += 1) {
      const faceOrdinal = graph.faceSubsetOrdinals[row] ?? 0;
      const start = graph.facePrimitiveStarts[faceOrdinal] ?? 0;
      const end = start + (graph.facePrimitiveCounts[faceOrdinal] ?? 0);
      for (let primitive = start; primitive < end; primitive += 1) {
        displayedByPrimitive[primitive] = 1;
      }
    }
    faceSubsetMasks.set(geometry, displayedByPrimitive);
    return displayedByPrimitive;
  }
  const displayedByPrimitive = new Uint8Array(Math.floor(geometry.indices.length / 3));
  const faces = geometry.faces;
  if (faces === undefined) return displayedByPrimitive;
  for (const ref of subset) {
    const face = faces.get(ref.elementId, ref.faceIndex);
    if (face === undefined) continue;
    const end = face.primitiveStart + face.primitiveCount;
    for (let primitive = face.primitiveStart; primitive < end; primitive += 1) {
      displayedByPrimitive[primitive] = 1;
    }
  }
  faceSubsetMasks.set(geometry, displayedByPrimitive);
  return displayedByPrimitive;
}

/** Validates that a render-time face subset resolves to declared face ranges. */
export function validateFaceSubset(geometry: GeometryInput): void {
  if (geometry.primitive !== "triangles") return;
  const subset = geometry.faceSubset;
  if (subset === undefined || subset.faceIds.length === 0) return;
  const faces = geometry.faces;
  if (faces === undefined) throw new Error("faceSubset requires declared faces");
  const faceIndex = facePairIndex(faces);
  const selected = createTypedPairIndex(subset.faceIds.length);
  for (let row = 0; row < subset.faceIds.length; row += 1) {
    const ref = subset.faceIds[row];
    if (ref === undefined) continue;
    if (findTypedPair(selected, subset.faceIds, ref.elementId, ref.faceIndex) !== undefined) {
      throw new Error(`faceSubset repeats element ${ref.elementId} face ${ref.faceIndex}`);
    }
    addTypedPair(selected, row, ref.elementId, ref.faceIndex);
    const face = findFace(faces, faceIndex, ref.elementId, ref.faceIndex);
    if (face === undefined || face.primitiveCount <= 0) {
      throw new Error(
        `faceSubset references undeclared element ${ref.elementId} face ${ref.faceIndex}`,
      );
    }
  }
}

/** Validates oriented face ranges, metadata, and their triangle coverage. */
export function validateFaceMetadata(
  geometry: GeometryInput,
  elements: readonly ElementTessellation[] | undefined,
  nodePositions: Float32Array | undefined,
): void {
  if (geometry.primitive !== "triangles" || geometry.faces === undefined) return;
  const elementLookup = elements === undefined ? undefined : elementOrdinalColumns(elements);
  const coverage = new Uint8Array(geometry.indices.length / 3);
  const faceIndex = createTypedPairIndex(geometry.faces.length);
  const nodeCount = nodePositions === undefined ? undefined : nodePositions.length / 3;
  for (let row = 0; row < geometry.faces.length; row += 1) {
    const face = geometry.faces[row];
    if (face === undefined) throw new Error(`Part has no face ${row}`);
    validateOneBasedId(face.elementId, "Face element owner");
    if (face.bodyId !== undefined) validateOneBasedId(face.bodyId, "Body");
    const elementOrdinal =
      elementLookup === undefined
        ? undefined
        : ordinalForId(elementLookup.ids, elementLookup.ordinals, face.elementId);
    if (elementLookup !== undefined && elementOrdinal === undefined) {
      throw new Error(`Face references undeclared element ${face.elementId}`);
    }
    const identity = faceIdentity(face.elementId, face.faceIndex);
    if (findTypedPair(faceIndex, geometry.faces, face.elementId, face.faceIndex) !== undefined) {
      throw new Error(`Duplicate oriented face ${identity}`);
    }
    addTypedPair(faceIndex, row, face.elementId, face.faceIndex);
    const element =
      elementOrdinal === undefined || elements === undefined ? undefined : elements[elementOrdinal];
    validateFaceRange(face, geometry.indices.length / 3, element);
    const end = face.primitiveStart + face.primitiveCount;
    for (let primitive = face.primitiveStart; primitive < end; primitive += 1) {
      if (coverage[primitive] === 1) {
        throw new Error(`Triangle ${primitive} belongs to more than one face`);
      }
      coverage[primitive] = 1;
    }
    if (element !== undefined && face.bodyId !== element.bodyId) {
      throw new Error(
        `Face ${identity} body ${String(face.bodyId)} does not match element ${face.elementId} body ${String(element.bodyId)}`,
      );
    }
    validateFaceNodes(identity, face.nodeIds, nodeCount);
    if (face.neighborElementId !== undefined) {
      validateOneBasedId(face.neighborElementId, "Face neighbor element");
      if (face.neighborElementId === face.elementId) {
        throw new Error(`Face ${identity} cannot neighbor its owner element`);
      }
    }
  }
  for (let primitive = 0; primitive < coverage.length; primitive += 1) {
    if (coverage[primitive] === 0)
      throw new Error(`Triangle ${primitive} is not covered by a face`);
  }
}

function validateFaceRange(
  face: FaceTessellation,
  primitiveCount: number,
  element: ElementTessellation | undefined,
): void {
  if (
    !Number.isInteger(face.faceIndex) ||
    face.faceIndex < 0 ||
    !Number.isInteger(face.primitiveStart) ||
    face.primitiveStart < 0 ||
    !Number.isInteger(face.primitiveCount) ||
    face.primitiveCount <= 0
  ) {
    throw new Error(
      `Face ${face.elementId}/${face.faceIndex} must have a non-empty integer primitive range`,
    );
  }
  const end = face.primitiveStart + face.primitiveCount;
  if (end > primitiveCount) {
    throw new Error(`Face ${face.elementId}/${face.faceIndex} is outside the triangle buffer`);
  }
  if (element !== undefined) {
    let ownsFace = false;
    for (const range of element.primitiveRanges) {
      if (
        range.primitive === "triangles" &&
        face.primitiveStart >= range.primitiveStart &&
        end <= range.primitiveStart + range.primitiveCount
      ) {
        ownsFace = true;
        break;
      }
    }
    if (!ownsFace) {
      throw new Error(`Face ${face.elementId}/${face.faceIndex} is outside its element range`);
    }
  }
}

function validateFaceNodes(
  identity: string,
  nodeIds: readonly number[],
  nodeCount: number | undefined,
): void {
  for (const nodeId of nodeIds) {
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      throw new Error(`Face ${identity} has invalid node reference ${nodeId}`);
    }
    if (nodeCount !== undefined && nodeId >= nodeCount) {
      throw new Error(`Face ${identity} references node ${nodeId} outside nodePositions`);
    }
  }
}

/** Returns the oriented face owning one logical triangle, if face metadata exists. */
export function faceForPrimitive(
  geometry: TriangleGeometry,
  primitive: number,
): FaceTessellation | undefined {
  const faces = geometry.faces;
  if (faces === undefined) return undefined;
  for (const face of faces) {
    if (primitive >= face.primitiveStart && primitive < face.primitiveStart + face.primitiveCount) {
      return face;
    }
  }
  return undefined;
}

function elementOrdinalColumns(elements: readonly ElementTessellation[]): {
  readonly ids: Uint32Array;
  readonly ordinals: Uint32Array;
} {
  const ids = new Uint32Array(elements.length);
  for (let ordinal = 0; ordinal < elements.length; ordinal += 1) {
    ids[ordinal] = elements[ordinal]?.id ?? 0;
  }
  return { ids, ordinals: sortedOrdinals(ids, "Part element", false) };
}

function facePairIndex(faces: readonly FaceTessellation[]): TypedPairIndex {
  const index = createTypedPairIndex(faces.length);
  for (let row = 0; row < faces.length; row += 1) {
    const face = faces[row];
    if (face !== undefined) addTypedPair(index, row, face.elementId, face.faceIndex);
  }
  return index;
}

function findFace(
  faces: readonly FaceTessellation[],
  index: TypedPairIndex,
  elementId: number,
  faceIndex: number,
): FaceTessellation | undefined {
  const row = findTypedPair(index, faces, elementId, faceIndex);
  return row === undefined ? undefined : faces[row];
}
