import { describe, expect, it } from "vitest";
import { SlotGroups } from "@/scene-runtime/slot-groups";

describe("SlotGroups sorted key ownership", () => {
  it("keeps repeated sparse keys sorted and caches same-key slot changes", () => {
    const groups = new SlotGroups(new Uint32Array([4, 2, 4, 4_294_967_295]));
    const initial = groups.sortedKeys();

    expect(initial).toEqual(new Uint32Array([2, 4, 4_294_967_295]));
    groups.add(4, 4);
    expect(groups.sortedKeys()).toBe(initial);
    groups.remove(4, 0);
    expect(groups.sortedKeys()).toBe(initial);
    expect(groups.slots(4)).toEqual([4, 2]);
  });

  it("invalidates only when a key first appears or its final slot is removed", () => {
    const groups = new SlotGroups(new Uint32Array([]));
    const empty = groups.sortedKeys();

    groups.add(9, 0);
    const withFirstKey = groups.sortedKeys();
    expect(withFirstKey).not.toBe(empty);
    expect(withFirstKey).toEqual(new Uint32Array([9]));
    groups.add(9, 1);
    expect(groups.sortedKeys()).toBe(withFirstKey);
    groups.remove(9, 0);
    expect(groups.sortedKeys()).toBe(withFirstKey);
    groups.remove(9, 1);
    expect(groups.sortedKeys()).not.toBe(withFirstKey);
    expect(groups.sortedKeys()).toEqual(new Uint32Array([]));
  });

  it("restores membership and the cached view after a failed journal", () => {
    const groups = new SlotGroups(new Uint32Array([7, 3]));
    const beforeKeys = groups.sortedKeys();
    const beforeSlots = [...groups.slots(3)];

    groups.beginJournal();
    groups.add(11, 2);
    groups.remove(3, 1);
    groups.rollbackJournal();

    expect(groups.sortedKeys()).toBe(beforeKeys);
    expect(groups.slots(3)).toEqual(beforeSlots);
    expect(groups.slots(11)).toEqual([]);
  });
});
