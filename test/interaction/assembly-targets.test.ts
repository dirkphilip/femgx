import { describe, expect, it } from "vitest";
import { createInteractionState } from "@/interaction/interaction";
import {
  clearSelection,
  selectedTargetCount,
  selectedTargets,
} from "@/interaction/selection-queries";
import {
  interactionTargetFromHit,
  isTargetHighlighted,
  isTargetSelected,
  setTargetHighlighted,
  setTargetSelected,
  setTargetHovered,
} from "@/interaction/targets";
import type { PickHit } from "@/picking/types";

const path = [
  { assemblyId: 1, assemblyOccurrenceId: "1" },
  { assemblyId: 2, assemblyOccurrenceId: "1/left" },
] as const;

const hit: PickHit = {
  kind: "partOccurrence",
  partId: 7,
  partOccurrenceId: "1/left/part",
  assemblyPath: path,
  worldPosition: [0, 0, 0],
};

describe("assembly interaction targets", () => {
  it("promotes a physical hit to its direct owning definition or occurrence", () => {
    expect(interactionTargetFromHit(hit, "assembly")).toEqual({ kind: "assembly", assemblyId: 2 });
    expect(interactionTargetFromHit(hit, "assemblyOccurrence")).toEqual({
      kind: "assemblyOccurrence",
      assemblyOccurrenceId: "1/left",
    });
  });

  it("keeps assembly selection and hover as logical immutable targets", () => {
    const assembly = { kind: "assembly", assemblyId: 2 } as const;
    const occurrence = { kind: "assemblyOccurrence", assemblyOccurrenceId: "1/left" } as const;
    const initial = createInteractionState();
    const selected = setTargetSelected(initial, assembly, true);
    const hovered = setTargetHovered(selected, occurrence);

    expect(selected).not.toBe(initial);
    expect(selectedTargets(selected)).toEqual([assembly]);
    expect(selectedTargetCount(selected, "assembly")).toBe(1);
    expect(isTargetSelected(selected, assembly)).toBe(true);
    expect(isTargetSelected(selected, occurrence)).toBe(false);
    expect(isTargetHighlighted(setTargetHighlighted(hovered, occurrence, true), occurrence)).toBe(
      true,
    );
    expect(selectedTargets(clearSelection(hovered))).toEqual([]);
  });
});
