import { describe, expect, it, vi } from "vitest";
import {
  updateSelectedTargetCollections,
  type TargetCollections,
  type TargetGroups,
} from "../../src/interaction/selection-transients";

describe("local selection group publication", () => {
  it("adopts fresh groups directly into empty destinations", () => {
    const groups = emptyGroups();
    const elements = new Set([41, 42]);
    const faces = new Map([
      ["41/0", { partOccurrenceId: "occurrence/a", elementId: 41, faceIndex: 0 }],
    ]);
    groups.partIds.add(7);
    groups.elementIds.set("occurrence/a", elements);
    groups.faceRefs.set("occurrence/a", faces);

    const { next, setAddCalls } = updateWithSetAddCount(emptyCollections(), groups, true);

    expect(next.partIds).toBe(groups.partIds);
    expect(next.elementIds.get("occurrence/a")).toBe(elements);
    expect(next.faceRefs.get("occurrence/a")).toBe(faces);
    expect(setAddCalls).toBe(0);
  });

  it("deletes complete nested groups while retaining the previous branch", () => {
    const existing = new Set([41, 42]);
    const current = collectionsWithElements(existing);
    const { next, setAddCalls } = updateWithSetAddCount(
      current,
      groupsWithElements(new Set([41, 42])),
      false,
    );

    expect(next.elementIds).not.toBe(current.elementIds);
    expect(next.elementIds.has("occurrence/a")).toBe(false);
    expect(current.elementIds.get("occurrence/a")).toBe(existing);
    expect(existing).toEqual(new Set([41, 42]));
    expect(setAddCalls).toBe(0);
  });

  it("clones affected groups once for partial append and removal", () => {
    const existing = new Set([41, 42]);
    const current = collectionsWithElements(existing);
    const appendedUpdate = updateWithSetAddCount(
      current,
      groupsWithElements(new Set([42, 43])),
      true,
    );
    const removedUpdate = updateWithSetAddCount(current, groupsWithElements(new Set([41])), false);
    const { next: appended } = appendedUpdate;
    const { next: removed } = removedUpdate;

    expect(appended.elementIds.get("occurrence/a")).toEqual(new Set([41, 42, 43]));
    expect(appended.elementIds.get("occurrence/a")).not.toBe(existing);
    expect(appendedUpdate.setAddCalls).toBe(3);
    expect(removed.elementIds.get("occurrence/a")).toEqual(new Set([42]));
    expect(removed.elementIds.get("occurrence/a")).not.toBe(existing);
    expect(removedUpdate.setAddCalls).toBe(2);
    expect(current.elementIds.get("occurrence/a")).toBe(existing);
    expect(existing).toEqual(new Set([41, 42]));
  });
});

function emptyGroups(): TargetGroups {
  return {
    partIds: new Set(),
    partOccurrenceIds: new Set(),
    bodyIds: new Map(),
    elementIds: new Map(),
    faceRefs: new Map(),
    nodeIds: new Map(),
    edgeRefs: new Map(),
  };
}

function groupsWithElements(values: Set<number>): TargetGroups {
  const groups = emptyGroups();
  groups.elementIds.set("occurrence/a", values);
  return groups;
}

function emptyCollections(): TargetCollections {
  return {
    partIds: new Set(),
    partOccurrenceIds: new Set(),
    bodyIds: new Map(),
    elementIds: new Map(),
    faceRefs: new Map(),
    nodeIds: new Map(),
    edgeRefs: new Map(),
  };
}

function collectionsWithElements(values: Set<number>): TargetCollections {
  return { ...emptyCollections(), elementIds: new Map([["occurrence/a", values]]) };
}

function updateWithSetAddCount(
  current: TargetCollections,
  groups: TargetGroups,
  enabled: boolean,
): { readonly next: TargetCollections; readonly setAddCalls: number } {
  const add = vi.spyOn(Set.prototype, "add");
  try {
    const next = updateSelectedTargetCollections(current, groups, enabled);
    return { next, setAddCalls: add.mock.calls.length };
  } finally {
    add.mockRestore();
  }
}
