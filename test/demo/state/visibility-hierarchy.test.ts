import { describe, expect, it } from "vitest";
import type { SceneOccurrences } from "@/entries/root";
import { VisibilityHierarchy } from "../../../demo/workbench/state/visibility-hierarchy";

describe("VisibilityHierarchy", () => {
  it("retains a 100k-node hierarchy in typed identityMatrix, parent, and adjacency columns", () => {
    const count = 100_000;
    const hierarchy = VisibilityHierarchy.build(flatHierarchy(count));

    expect(hierarchy.count).toBe(count);
    expect(hierarchy.assemblyDefinitionIds).toBeInstanceOf(Uint32Array);
    expect(hierarchy.occurrenceOffsets).toBeInstanceOf(Uint32Array);
    expect(hierarchy.occurrenceText).toBeInstanceOf(Uint16Array);
    expect(hierarchy.parents).toBeInstanceOf(Int32Array);
    expect(hierarchy.firstChildren).toBeInstanceOf(Int32Array);
    expect(hierarchy.nextSiblings).toBeInstanceOf(Int32Array);
    expect(hierarchy.expanded).toBeInstanceOf(Uint8Array);
    expect(hierarchy.collapsed).toBeInstanceOf(Uint8Array);
    expect(hierarchy.childCount(0)).toBe(count - 1);
  });

  it("keeps expansion state by exact packed occurrence identityMatrix across a rebuild", () => {
    const runtime = flatHierarchy(100_000);
    const initial = VisibilityHierarchy.build(runtime);
    initial.toggleExpanded(50_000);
    const rebuilt = VisibilityHierarchy.build(runtime, initial);

    expect(rebuilt.ordinalOf(runtime, "50000")).toBe(50_000);
    expect(rebuilt.isExpanded(50_000)).toBe(false);
  });
});

function flatHierarchy(count: number): SceneOccurrences {
  return {
    rootAssemblyId: 1,
    assemblyOccurrenceCount: count,
    partOccurrenceCount: 0,
    visibleCount: 0,
    getPartOccurrenceId: () => undefined,
    getAssemblyOccurrenceId: (ordinal) =>
      ordinal >= 0 && ordinal < count ? String(ordinal) : undefined,
    partOccurrences: () => [],
    assemblyOccurrences: () => [],
    getPartOccurrence: () => undefined,
    getAssemblyOccurrence: (id) => {
      const ordinal = Number(id);
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= count) return undefined;
      return {
        assemblyOccurrenceId: id,
        placementId: ordinal === 0 ? undefined : id,
        assemblyId: 1,
        parentAssemblyOccurrenceId: ordinal === 0 ? undefined : "0",
        childCount: ordinal === 0 ? count - 1 : 0,
        getChildId: (childOrdinal) =>
          ordinal === 0 && childOrdinal >= 0 && childOrdinal < count - 1
            ? String(childOrdinal + 1)
            : undefined,
        partOccurrenceCount: 0,
        getPartOccurrenceId: () => undefined,
        visible: true,
        effectiveVisible: true,
      };
    },
    getPartId: () => undefined,
    getTransform: () => undefined,
    isPartOccurrenceVisible: () => false,
    visiblePartOccurrenceIds: () => [],
  };
}
