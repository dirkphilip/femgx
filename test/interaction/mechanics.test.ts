import { describe, expect, it, vi } from "vitest";
import {
  diffMapValues,
  diffNestedSetMembers,
  diffSetMembers,
} from "../../src/interaction/mechanics";

describe("immutable interaction diffs", () => {
  it("does not enumerate collections whose identity is unchanged", () => {
    const values = new Set([1, 2]);
    const nested = new Map([["instance", values]]);
    const flat = new Map([["instance", { color: "red" }]]);
    const valuesIterator = vi.spyOn(values, Symbol.iterator);
    const nestedIterator = vi.spyOn(nested, Symbol.iterator);
    const flatIterator = vi.spyOn(flat, Symbol.iterator);
    const visit = vi.fn();

    diffSetMembers(values, values, visit);
    diffNestedSetMembers(nested, nested, visit);
    diffMapValues(flat, flat, visit);

    expect(valuesIterator).not.toHaveBeenCalled();
    expect(nestedIterator).not.toHaveBeenCalled();
    expect(flatIterator).not.toHaveBeenCalled();
    expect(visit).not.toHaveBeenCalled();
  });

  it("does not enumerate a shared nested set through new outer maps", () => {
    const values = new Set([1, 2]);
    const iterator = vi.spyOn(values, Symbol.iterator);
    const previous = new Map([["instance", values]]);
    const next = new Map([["instance", values]]);

    diffNestedSetMembers(previous, next, vi.fn());

    expect(iterator).not.toHaveBeenCalled();
  });
});
