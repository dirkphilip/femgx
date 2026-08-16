import type { Part, PartId } from "../geometry/part";
import { destroyPartResources, type DrawResources } from "./resources/gpu-draw";

/** Returns part ids whose immutable definitions differ by object identity. */
export function changedPartDefinitions(
  previous: ReadonlyMap<PartId, Part>,
  next: ReadonlyMap<PartId, Part>,
): ReadonlySet<PartId> | undefined {
  let changed: Set<PartId> | undefined;
  for (const [partId, part] of previous) {
    if (next.get(partId) === part) continue;
    (changed ??= new Set()).add(partId);
  }
  for (const [partId, part] of next) {
    if (previous.get(partId) === part) continue;
    (changed ??= new Set()).add(partId);
  }
  return changed;
}

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
