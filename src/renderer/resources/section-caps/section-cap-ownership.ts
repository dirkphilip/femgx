import type { PartId } from "../../../geometry/part";

/** Records exact section-cap ownership for one source part definition. */
export function registerSectionCapOwner(
  sourceCapIds: Map<PartId, Set<PartId>>,
  sourcePartId: PartId,
  capId: PartId,
): void {
  let capIds = sourceCapIds.get(sourcePartId);
  if (capIds === undefined) {
    capIds = new Set();
    sourceCapIds.set(sourcePartId, capIds);
  }
  capIds.add(capId);
}
