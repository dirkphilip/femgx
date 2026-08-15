import {
  facesOf,
  FaceSelectionError,
  type ElementFace,
  type FaceIdRef,
  type FaceKey,
} from "../elements/faces";
import type { Element, ElementId } from "../elements/element";

/** One source element face selected for tessellation. */
export interface ElementRenderFace {
  readonly element: Element;
  readonly face: ElementFace;
  readonly faceIndex: number;
}

/** Builds render faces and validates shared-face incidence in one traversal. */
export function analyzeElementFaces(elements: readonly Element[]): {
  readonly faces: readonly ElementRenderFace[];
  readonly neighbors: ReadonlyMap<FaceKey, readonly ElementId[]>;
} {
  const faces: ElementRenderFace[] = [];
  const neighbors = new Map<FaceKey, ElementId[]>();
  for (const element of elements) {
    const elementFaces = facesOf(element);
    for (const [faceIndex, face] of elementFaces.entries()) {
      faces.push({ element, face, faceIndex });
      const incident = neighbors.get(face.key);
      if (incident === undefined) neighbors.set(face.key, [element.id]);
      else if (incident.push(element.id) > 2) {
        throw new Error(`Non-manifold face ${face.key} has ${incident.length} incident elements`);
      }
    }
  }
  return { faces, neighbors };
}

/** Validates face identities against one pre-partitioned element list. */
export function validateFaceSelectionForElements(
  elements: readonly Element[],
  selection: readonly FaceIdRef[],
  family = "heterogeneous",
): ReadonlySet<string> {
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
