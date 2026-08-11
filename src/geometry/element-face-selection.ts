import {
  classifyFaces,
  facesOf,
  facesOfElement,
  FaceSelectionError,
  type ElementFace,
  type FaceIdRef,
  type FaceKey,
} from "../elements/faces";
import type { Element, ElementId } from "../elements/element";
import type { ElementModel } from "../elements/model";
import type { ElementFamily } from "../elements/shapes";

/** One source element face selected for tessellation. */
export interface ElementRenderFace {
  readonly element: Element;
  readonly face: ElementFace;
  readonly faceIndex: number;
}

/** Returns model elements belonging to one renderable family. */
export function elementsOf(model: ElementModel, family: ElementFamily): readonly Element[] {
  return model.elements.filter((element) => element.shape.family === family);
}

/** Maps each canonical face key to every element incident to it. */
export function faceNeighbors(elements: readonly Element[]): Map<FaceKey, ElementId[]> {
  const neighbors = new Map<FaceKey, ElementId[]>();
  for (const element of elements) {
    for (const face of facesOf(element)) {
      const list = neighbors.get(face.key);
      if (list === undefined) neighbors.set(face.key, [element.id]);
      else list.push(element.id);
    }
  }
  return neighbors;
}

/** Returns every face in deterministic element/topology order. */
export function allFaces(model: ElementModel, family: ElementFamily): readonly ElementRenderFace[] {
  return elementsOf(model, family).flatMap((element) =>
    facesOfElement(element).map(({ face, faceIndex }) => ({ element, face, faceIndex })),
  );
}

/** Returns only boundary faces, preserving the source element/topology order. */
export function boundaryFaces(
  model: ElementModel,
  family: ElementFamily,
): readonly ElementRenderFace[] {
  const elements = elementsOf(model, family);
  const classified = classifyFaces(elements);
  const faces = allFaces(model, family);
  return faces.filter((_, index) => classified[index]?.boundary === true);
}

/** Validates face identities and returns a deterministic lookup set. */
export function validateFaceSelection(
  model: ElementModel,
  family: ElementFamily,
  selection: readonly FaceIdRef[],
): ReadonlySet<string> {
  const elements = elementsOf(model, family);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const identities = new Set<string>();
  for (const ref of selection) {
    if (!Number.isInteger(ref.elementId) || ref.elementId < 0 || !byId.has(ref.elementId)) {
      throw new FaceSelectionError(
        "invalid-element-id",
        `Face subset references element ${String(ref.elementId)} outside ${family} elements`,
      );
    }
    if (!Number.isInteger(ref.faceIndex) || ref.faceIndex < 0) {
      throw new FaceSelectionError(
        "invalid-face-index",
        `Face subset references invalid face index ${String(ref.faceIndex)}`,
      );
    }
    const element = byId.get(ref.elementId);
    const face = element === undefined ? undefined : facesOf(element)[ref.faceIndex];
    if (face === undefined) {
      throw new FaceSelectionError(
        "invalid-face-index",
        `Element ${ref.elementId} has no face at index ${ref.faceIndex}`,
      );
    }
    const identity = faceIdentity(ref.elementId, ref.faceIndex);
    if (identities.has(identity)) {
      throw new FaceSelectionError(
        "duplicate-face",
        `Face subset repeats element ${ref.elementId} face ${ref.faceIndex}`,
      );
    }
    identities.add(identity);
  }
  return identities;
}

/** Stable lookup key for an element-local face identity. */
export function faceIdentity(elementId: ElementId, faceIndex: number): string {
  return `${elementId}/${faceIndex}`;
}
