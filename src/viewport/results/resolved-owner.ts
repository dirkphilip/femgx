import type { Part, PartId } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { ResultColorMap } from "../../results/colors";
import type { OrientationRecordMap } from "../results-roles";
import type { ViewportResultsState } from "../results-types";

/** Renderer-ready data owned by one resolved public result snapshot. */
export interface ResolvedViewportResultData {
  colors: ResultColorMap | undefined;
  renderedParts: ReadonlyMap<PartId, Part> | undefined;
  sharedDeformation: DeformationState | undefined;
  orientationRecords: OrientationRecordMap | undefined;
  orientationWidth: number;
}

const resultData = Symbol("resolved-viewport-result-data");

/** Internal aggregate retaining the public result projection and renderer data. */
export type ResolvedViewportResults = ViewportResultsState & {
  readonly [resultData]: ResolvedViewportResultData;
};

/** Attaches renderer-ready data to one resolved public result projection. */
export function createResolvedViewportResults(
  state: ViewportResultsState,
  data: ResolvedViewportResultData,
): ResolvedViewportResults {
  return { ...state, [resultData]: data };
}

/** Returns the internal aggregate data for a resolver-owned public projection. */
export function resolvedViewportResultData(
  state: ViewportResultsState,
): ResolvedViewportResultData | undefined {
  return isResolvedViewportResults(state) ? state[resultData] : undefined;
}

function isResolvedViewportResults(state: ViewportResultsState): state is ResolvedViewportResults {
  return resultData in state;
}
