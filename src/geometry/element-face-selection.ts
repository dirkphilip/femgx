import type { ElementId } from "../elements/element";

/** Stable lookup key for an element-local face identity. */
export function faceIdentity(elementId: ElementId, faceIndex: number): string {
  return `${elementId}/${faceIndex}`;
}
