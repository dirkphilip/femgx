import type { ElementTessellation, FaceTessellation } from "./types";
import {
  addTypedPair,
  createTypedPairIndex,
  findTypedPair,
  type TypedPairIndex,
} from "./semantic/typed-pair-index";
import { sortedOrdinals } from "../elements/model-storage";

/** Builds the stable element-id lookup columns shared by geometry validators. */
export function elementOrdinalColumns(elements: readonly ElementTessellation[]): {
  readonly ids: Uint32Array;
  readonly ordinals: Uint32Array;
} {
  const ids = new Uint32Array(elements.length);
  for (let ordinal = 0; ordinal < elements.length; ordinal += 1) {
    ids[ordinal] = elements[ordinal]?.id ?? 0;
  }
  return { ids, ordinals: sortedOrdinals(ids, "Part element", false) };
}

/** Builds a transient index for authored element/face identity pairs. */
export function facePairIndex(faces: readonly FaceTessellation[]): TypedPairIndex {
  const index = createTypedPairIndex(faces.length);
  for (let row = 0; row < faces.length; row += 1) {
    const face = faces[row];
    if (face !== undefined) addTypedPair(index, row, face.elementId, face.faceIndex);
  }
  return index;
}

/** Finds an authored face by its stable element/face identity pair. */
export function findFace(
  faces: readonly FaceTessellation[],
  index: TypedPairIndex,
  elementId: number,
  faceIndex: number,
): FaceTessellation | undefined {
  const row = findTypedPair(index, faces, elementId, faceIndex);
  return row === undefined ? undefined : faces[row];
}
