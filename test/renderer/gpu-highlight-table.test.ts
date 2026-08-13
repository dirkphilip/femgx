import { describe, expect, it } from "vitest";
import {
  buildHighlightTable,
  HIGHLIGHT_BUCKET_SIZE,
  highlightHash,
  type HighlightTableEntry,
} from "../../src/renderer/gpu-highlight-table";

function entry(slot: number, elementPickId: number): HighlightTableEntry {
  return {
    slot,
    elementPickId,
    facePickId: 0,
    nodePickId: 0,
    data: new ArrayBuffer(48),
  };
}

describe("buildHighlightTable", () => {
  it("places every entry in the bucket selected by the shared hash", () => {
    const entries = Array.from({ length: 40 }, (_, index) => entry(index % 5, index + 1));
    const table = buildHighlightTable(entries, 128);
    expect(table).toBeDefined();
    if (table === undefined) return;

    expect(table.bucketCount).toBeGreaterThan(0);
    expect(table.bucketCount & (table.bucketCount - 1)).toBe(0);
    for (const item of entries) {
      const bucket =
        highlightHash(item.slot, item.elementPickId, 0, 0, table.seed) & (table.bucketCount - 1);
      const start = bucket * HIGHLIGHT_BUCKET_SIZE;
      const matches = table.entries
        .slice(start, start + HIGHLIGHT_BUCKET_SIZE)
        .filter(
          (candidate) =>
            candidate?.slot === item.slot && candidate.elementPickId === item.elementPickId,
        );
      expect(matches).toHaveLength(1);
    }
  });

  it("reports when the physical buffer cannot fit a bounded table", () => {
    const entries = Array.from({ length: 65 }, (_, index) => entry(index, index + 1));
    expect(buildHighlightTable(entries, HIGHLIGHT_BUCKET_SIZE * 8)).toBeUndefined();
  });

  it("places the same semantic entries identically regardless of input order", () => {
    const entries = Array.from({ length: 40 }, (_, index) => entry(index % 5, index + 1));
    const forward = buildHighlightTable(entries, 128);
    const reversed = buildHighlightTable([...entries].reverse(), 128);

    expect(reversed?.seed).toBe(forward?.seed);
    expect(reversed?.entries).toEqual(forward?.entries);
  });
});
