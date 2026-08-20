import { describe, expect, it } from "vitest";
import {
  denseMembershipContains,
  denseMembershipOccurrenceAtSlot,
  sortDenseMembershipOccurrences,
} from "@/renderer/selection/dense-membership";

describe("dense membership representation", () => {
  it("sorts and resolves occurrence records by local slot", () => {
    const occurrences = sortDenseMembershipOccurrences([
      { slot: 7, selectedCount: 1, words: new Uint32Array([0]) },
      { slot: 2, selectedCount: 2, words: new Uint32Array([1, 2]) },
    ]);
    const membership = { occurrences };

    expect(occurrences.map((occurrence) => occurrence.slot)).toEqual([2, 7]);
    expect(denseMembershipOccurrenceAtSlot(membership, 2)).toBe(occurrences[0]);
    expect(denseMembershipOccurrenceAtSlot(membership, 7)).toBe(occurrences[1]);
    expect(denseMembershipOccurrenceAtSlot(membership, 3)).toBeUndefined();
  });

  it("rejects malformed slots and missing member indices", () => {
    const occurrence = { slot: 2, selectedCount: 2, words: new Uint32Array([1, 2]) };
    const membership = { occurrences: [occurrence] };

    expect(denseMembershipOccurrenceAtSlot(membership, -1)).toBeUndefined();
    expect(denseMembershipOccurrenceAtSlot(membership, 2.5)).toBeUndefined();
    expect(denseMembershipOccurrenceAtSlot(membership, Number.NaN)).toBeUndefined();
    expect(denseMembershipContains(occurrence, 0)).toBe(true);
    expect(denseMembershipContains(occurrence, 33)).toBe(true);
    expect(denseMembershipContains(occurrence, 1)).toBe(false);
    expect(denseMembershipContains(occurrence, -1)).toBe(false);
    expect(denseMembershipContains(occurrence, 0.5)).toBe(false);
    expect(denseMembershipContains(undefined, 0)).toBe(false);
  });
});
