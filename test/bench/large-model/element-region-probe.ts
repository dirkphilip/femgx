import type { PickRegionProbe } from "@/renderer/picking/region";

/** Creates resettable renderer-owned evidence counters for one visible query. */
export function emptyVisibleProbe(): PickRegionProbe {
  return {
    elementDecodedPixels: 0,
    rawIdentityObjects: 0,
    resolvedTargetDescriptors: 0,
    elementPickGroups: 0,
    elementPickIds: 0,
    elementScratchBytes: 0,
    elementScratchGrowths: 0,
    elementOutputBytes: 0,
  };
}
