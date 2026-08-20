import { describe, expect, it } from "vitest";
import {
  buildHighlightTable,
  HIGHLIGHT_BUCKET_SIZE,
  highlightHash,
  type HighlightTableEntry,
} from "@/renderer/selection/highlight-table";

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
    const table = buildHighlightTable(entries);

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

  it("grows the logical table until a collision-heavy selection fits", () => {
    const entries = Array.from({ length: 1_024 }, (_, index) => entry(0, index + 1));
    const table = buildHighlightTable(entries);
    expect(table.bucketCount).toBe(1_024);
    expect(table.entries).toHaveLength(1_024 * HIGHLIGHT_BUCKET_SIZE);
  });

  it("rejects duplicate lookup keys instead of growing without bound", () => {
    expect(() => buildHighlightTable(Array.from({ length: 5 }, () => entry(0, 1)))).toThrow(
      "Cannot build bounded highlight table for 5 records",
    );
  });

  it("places the same semantic entries identically regardless of input order", () => {
    const entries = Array.from({ length: 40 }, (_, index) => entry(index % 5, index + 1));
    const forward = buildHighlightTable(entries);
    const reversed = buildHighlightTable([...entries].reverse());

    expect(reversed.seed).toBe(forward.seed);
    expect(reversed.entries).toEqual(forward.entries);
  });
});
