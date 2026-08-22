import type { PartId } from "../../geometry/part";
import type { ViewportOccurrenceResultsConfig, ViewportResultsConfig } from "../results-types";
import type { ResultResolutionView } from "./resolution-view";

/** Narrows one retained result snapshot to bindings owned by revised definitions. */
export function scopedPartRevisionConfig(
  config: ViewportResultsConfig,
  view: ResultResolutionView,
  revisedPartIds: ReadonlySet<PartId>,
): ViewportResultsConfig | undefined {
  const applies = (partId: PartId | undefined): boolean =>
    partId === undefined || revisedPartIds.has(partId);
  const occurrences = revisionOccurrences(config.occurrences, view, revisedPartIds);
  const scalar = applies(config.scalar?.partId) ? config.scalar : undefined;
  const orientation =
    config.orientation === undefined ||
    applies(
      config.orientation.glyph === "triad"
        ? config.orientation.field.partId
        : config.orientation.partId,
    )
      ? config.orientation
      : undefined;
  const loads = applies(config.loads?.field.partId) ? config.loads : undefined;
  const shared = {
    ...(config.deformation === undefined ? {} : { deformation: config.deformation }),
    ...(orientation === undefined ? {} : { orientation }),
    ...(loads === undefined ? {} : { loads }),
    ...(occurrences === undefined ? {} : { occurrences }),
  };
  if (scalar !== undefined) return { ...shared, scalar };
  if (config.deformation !== undefined) return { ...shared, deformation: config.deformation };
  if (orientation !== undefined) return { ...shared, orientation };
  if (loads !== undefined) return { ...shared, loads };
  return occurrences === undefined ? undefined : { occurrences };
}

function revisionOccurrences(
  occurrences: readonly ViewportOccurrenceResultsConfig[] | undefined,
  view: ResultResolutionView,
  revisedPartIds: ReadonlySet<PartId>,
): [ViewportOccurrenceResultsConfig, ...ViewportOccurrenceResultsConfig[]] | undefined {
  if (occurrences === undefined) return undefined;
  const revised = occurrences.filter((occurrence) => {
    const partId = view.partIdForOccurrence(occurrence.partOccurrenceId);
    return partId !== undefined && revisedPartIds.has(partId);
  });
  const first = revised[0];
  return first === undefined ? undefined : [first, ...revised.slice(1)];
}
