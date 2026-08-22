import type { PartId } from "../../geometry/part";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { PartOccurrenceId } from "../../scene/types";

/**
 * Semantic identities available to result resolution; it deliberately has no packed slot API.
 */
export interface ResultResolutionView {
  readonly renderedPartIds: ReadonlySet<PartId>;
  partIdForOccurrence(id: PartOccurrenceId): PartId | undefined;
  occurrencesForPart(partId: PartId): readonly PartOccurrenceId[];
}

/** Adapts one complete packed runtime to the result resolver's semantic view. */
export function createResultResolutionView(runtime: PackedSceneRuntime): ResultResolutionView {
  const partIds = new Set<PartId>();
  const occurrencesByPart = new Map<PartId, PartOccurrenceId[]>();
  const partsByOccurrence = new Map<PartOccurrenceId, PartId>();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.getPartId(slot);
    const occurrenceId = runtime.getInstanceId(slot);
    if (partId === undefined || occurrenceId === undefined) continue;
    partIds.add(partId);
    const occurrences = occurrencesByPart.get(partId) ?? [];
    occurrences.push(occurrenceId);
    occurrencesByPart.set(partId, occurrences);
    partsByOccurrence.set(occurrenceId, partId);
  }
  return createView(partIds, occurrencesByPart, partsByOccurrence);
}

/** Creates the semantic view containing only the occurrences of revised part definitions. */
export function createPartRevisionResultResolutionView(
  source: ResultResolutionView,
  revisedPartIds: ReadonlySet<PartId>,
): ResultResolutionView {
  const partIds = new Set<PartId>();
  const occurrencesByPart = new Map<PartId, readonly PartOccurrenceId[]>();
  const partsByOccurrence = new Map<PartOccurrenceId, PartId>();
  for (const partId of revisedPartIds) {
    if (!source.renderedPartIds.has(partId)) continue;
    const occurrences = source.occurrencesForPart(partId);
    partIds.add(partId);
    occurrencesByPart.set(partId, occurrences);
    for (const occurrenceId of occurrences) partsByOccurrence.set(occurrenceId, partId);
  }
  return createView(partIds, occurrencesByPart, partsByOccurrence);
}

function createView(
  renderedPartIds: ReadonlySet<PartId>,
  occurrencesByPart: ReadonlyMap<PartId, readonly PartOccurrenceId[]>,
  partsByOccurrence: ReadonlyMap<PartOccurrenceId, PartId>,
): ResultResolutionView {
  return {
    renderedPartIds,
    partIdForOccurrence: (id) => partsByOccurrence.get(id),
    occurrencesForPart: (partId) => occurrencesByPart.get(partId) ?? [],
  };
}
