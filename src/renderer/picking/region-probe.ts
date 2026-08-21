/** Mutable counters for local evidence of the internal region-discovery shape. */
export interface PickRegionProbe {
  /** Render pixels read from the two element attachments. */
  elementDecodedPixels: number;
  rawIdentityObjects: number;
  resolvedTargetDescriptors: number;
  elementPickGroups: number;
  elementPickIds: number;
  /** Retained private pair-column capacity, including radix counters. */
  elementScratchBytes: number;
  /** Pair-column growths in this query (zero after warmed repeated reads). */
  elementScratchGrowths: number;
  /** Public typed-column bytes returned for this query. */
  elementOutputBytes: number;
}
