import type { Part, PartId } from "../geometry/part";
import { destroyPartResources, type DrawResources } from "./gpu-draw";

/** Reconciles cached per-part GPU resources against the next scene registry. */
export function reconcilePartResources(
  previous: ReadonlyMap<PartId, Part>,
  next: ReadonlyMap<PartId, Part>,
  draw: DrawResources,
): ReadonlyMap<PartId, Part> {
  let changed = previous.size !== next.size;
  for (const [partId, previousPart] of previous) {
    if (next.get(partId) !== previousPart) {
      changed = true;
      destroyPartResources(draw, partId);
    }
  }
  return changed ? new Map(next) : previous;
}
