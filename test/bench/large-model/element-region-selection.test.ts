import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  selectedElementRegion,
  setElementRegionSelected,
  type ElementRegionSelection,
} from "@/entries/interaction";

const COUNTS = [1, 65_856, 131_712, 257_250, 1_000_000] as const;

describe("packed element-region selection scaling", () => {
  it.each(COUNTS)("applies %i authored element ids without descriptor expansion", (count) => {
    const selection = denseSelection(count);
    const durations: number[] = [];
    let state = createInteractionState();
    for (let sample = 0; sample < 3; sample += 1) {
      const start = performance.now();
      state = setElementRegionSelected(createInteractionState(), selection, "replace");
      durations.push(performance.now() - start);
    }
    durations.sort((left, right) => left - right);
    const snapshot = selectedElementRegion(state);

    expect(selection.elementIds.byteLength).toBe(count * Uint32Array.BYTES_PER_ELEMENT);
    expect(selection.offsets.byteLength).toBe(2 * Uint32Array.BYTES_PER_ELEMENT);
    expect(snapshot.count).toBe(count);
    expect(snapshot.partOccurrenceIds).toEqual(["bench/0"]);
    expect(snapshot.elementIds[0]).toBe(1);
    expect(snapshot.elementIds.at(-1)).toBe(count);
    expect(durations[1]).toBeGreaterThanOrEqual(0);
    expect(durations[2]).toBeGreaterThanOrEqual(durations[1] ?? 0);
  });
});

function denseSelection(count: number): ElementRegionSelection {
  const elementIds = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) elementIds[index] = index + 1;
  return {
    kind: "element",
    count,
    partOccurrenceIds: ["bench/0"],
    offsets: new Uint32Array([0, count]),
    elementIds,
  };
}
