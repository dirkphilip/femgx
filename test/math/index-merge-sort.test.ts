import { describe, expect, it } from "vitest";
import { sortIndexRows } from "../../src/math/index-merge-sort";

describe("typed index merge sort", () => {
  it("returns an empty result without invoking the comparator", () => {
    let comparisons = 0;
    const result = sortIndexRows(0, () => {
      comparisons += 1;
      return 0;
    });

    expect(result).toEqual(new Uint32Array());
    expect(comparisons).toBe(0);
  });

  it("keeps a singleton row in place", () => {
    expect(sortIndexRows(1, () => 0)).toEqual(new Uint32Array([0]));
  });

  it("sorts a non-power-of-two row count", () => {
    const keys = [3, 1, 4, 1, 2];
    expect(
      sortIndexRows(keys.length, (left, right) => (keys[left] ?? 0) - (keys[right] ?? 0)),
    ).toEqual(new Uint32Array([1, 3, 4, 0, 2]));
  });

  it("keeps duplicate keys in their original row order", () => {
    const keys = new Uint32Array([2, 1, 2, 1]);
    expect(
      sortIndexRows(keys.length, (left, right) => (keys[left] ?? 0) - (keys[right] ?? 0)),
    ).toEqual(new Uint32Array([1, 3, 0, 2]));
  });

  it("preserves every row when the comparator ties", () => {
    expect(sortIndexRows(5, () => 0)).toEqual(new Uint32Array([0, 1, 2, 3, 4]));
  });
});
