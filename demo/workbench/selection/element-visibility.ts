import type { ElementTessellation, Part, PartOccurrenceId } from "@/entries/root";
import { isBodyVisible, isElementVisible, type InteractionState } from "@/entries/interaction";
import type { BodyId } from "@/entries/model";

const bodyIdsByPart = new WeakMap<Part, ReadonlyMap<number, BodyId>>();

/** Returns whether an element occurrence passes both element and body visibility gates. */
export function isElementOccurrenceVisible(
  state: InteractionState,
  part: Part,
  partOccurrenceId: PartOccurrenceId,
  element: ElementTessellation,
): boolean {
  if (!isElementVisible(state, { partOccurrenceId, elementId: element.id })) return false;
  const bodyId = element.bodyId ?? bodyIdsForPart(part).get(element.id);
  return bodyId === undefined || isBodyVisible(state, { partOccurrenceId, bodyId });
}

function bodyIdsForPart(part: Part): ReadonlyMap<number, BodyId> {
  const cached = bodyIdsByPart.get(part);
  if (cached !== undefined) return cached;
  const bodyIds = new Map<number, BodyId>();
  for (const body of part.bodies ?? []) {
    for (const elementId of body.elementIds) bodyIds.set(elementId, body.id);
  }
  bodyIdsByPart.set(part, bodyIds);
  return bodyIds;
}
