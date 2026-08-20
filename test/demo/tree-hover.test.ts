import { describe, expect, it } from "vitest";
import type { SceneOccurrences } from "../../src/scene-runtime/occurrences";
import type { Viewport } from "../../src/entries/root";
import type { InteractionState } from "../../src/entries/interaction";
import {
  createInteractionState,
  setPartOccurrenceHighlighted,
} from "../../src/interaction/interaction";
import { isTargetHighlighted } from "../../src/interaction/targets";
import {
  applyDisplayedInteraction,
  clearHierarchyHover,
  setHierarchyHover,
  type WorkbenchHoverController,
} from "../../demo/workbench/controllers/controller-hover";
import {
  interactionTargetsForRow,
  visibilityRowTargetsEqual,
} from "../../demo/workbench/state/visibility-snapshot";

describe("visibility tree hover mapping", () => {
  it("projects visible assembly descendants while mapping ordinary rows", () => {
    const occurrences = new Map([
      [
        "1/0",
        {
          assemblyOccurrenceId: "1/0",
          assemblyId: 1,
          parentAssemblyOccurrenceId: undefined,
          childCount: 1,
          getChildId: (ordinal: number) => (ordinal === 0 ? "1/0/0" : undefined),
          partOccurrenceCount: 1,
          getPartOccurrenceId: (ordinal: number) => (ordinal === 0 ? "1/0/0" : undefined),
          visible: true,
          effectiveVisible: true,
        },
      ],
      [
        "1/0/0",
        {
          assemblyOccurrenceId: "1/0/0",
          assemblyId: 2,
          parentAssemblyOccurrenceId: "1/0",
          childCount: 0,
          getChildId: () => undefined,
          partOccurrenceCount: 2,
          getPartOccurrenceId: (ordinal: number) =>
            ordinal === 0 ? "1/0/0/0" : ordinal === 1 ? "1/0/0/1" : undefined,
          visible: true,
          effectiveVisible: true,
        },
      ],
    ]);
    const visibleInstances = new Set(["1/0/0", "1/0/0/1"]);
    const runtime = {
      getAssemblyOccurrence: (id: string) => occurrences.get(id),
      isPartOccurrenceVisible: (id: string) => visibleInstances.has(id),
    } as unknown as SceneOccurrences;

    expect(interactionTargetsForRow(runtime, { kind: "assembly", occurrenceId: "1/0" })).toEqual([
      { kind: "partOccurrence", partOccurrenceId: "1/0/0" },
      { kind: "partOccurrence", partOccurrenceId: "1/0/0/1" },
    ]);
    expect(
      interactionTargetsForRow(runtime, { kind: "partOccurrence", partOccurrenceId: "1/1/0" }),
    ).toEqual([{ kind: "partOccurrence", partOccurrenceId: "1/1/0" }]);
    expect(
      interactionTargetsForRow(runtime, { kind: "body", partOccurrenceId: "1/0/0", bodyId: 4 }),
    ).toEqual([{ kind: "body", partOccurrenceId: "1/0/0", bodyId: 4 }]);
  });

  it("compares row identityMatrix so stale leave events cannot clear a newer row", () => {
    const body = { kind: "body", partOccurrenceId: "1/0/0", bodyId: 4 } as const;
    expect(visibilityRowTargetsEqual(body, { ...body })).toBe(true);
    expect(
      visibilityRowTargetsEqual(body, { kind: "body", partOccurrenceId: "1/0/0", bodyId: 5 }),
    ).toBe(false);
    expect(
      visibilityRowTargetsEqual(body, { kind: "partOccurrence", partOccurrenceId: "1/0/0" }),
    ).toBe(false);
  });

  it("derives assembly emphasis without erasing persistent highlights", () => {
    const occurrences = new Map([
      [
        "1/0",
        {
          assemblyOccurrenceId: "1/0",
          assemblyId: 1,
          parentAssemblyOccurrenceId: undefined,
          childCount: 1,
          getChildId: (ordinal: number) => (ordinal === 0 ? "1/0/0" : undefined),
          partOccurrenceCount: 1,
          getPartOccurrenceId: (ordinal: number) => (ordinal === 0 ? "1/0/0" : undefined),
          visible: true,
          effectiveVisible: true,
        },
      ],
      [
        "1/0/0",
        {
          assemblyOccurrenceId: "1/0/0",
          assemblyId: 2,
          parentAssemblyOccurrenceId: "1/0",
          childCount: 0,
          getChildId: () => undefined,
          partOccurrenceCount: 1,
          getPartOccurrenceId: (ordinal: number) => (ordinal === 0 ? "1/0/0/0" : undefined),
          visible: true,
          effectiveVisible: true,
        },
      ],
    ]);
    const runtime = {
      getAssemblyOccurrence: (id: string) => occurrences.get(id),
      isPartOccurrenceVisible: () => true,
    } as unknown as SceneOccurrences;
    let displayed: InteractionState | undefined;
    const viewport = {
      occurrences: runtime,
      interaction: {
        set: (state: InteractionState) => {
          displayed = state;
        },
      },
    } as unknown as Viewport;
    const owner = {
      disposed: false,
      hoverOwner: undefined,
      interaction: setPartOccurrenceHighlighted(createInteractionState(), "1/0/0", true),
      viewportSlots: { clearHover: () => undefined },
      render: () => undefined,
      viewports: () => [viewport],
    } as WorkbenchHoverController;
    const assembly = { kind: "assembly", occurrenceId: "1/0" } as const;

    setHierarchyHover(owner, assembly);
    applyDisplayedInteraction(owner);
    expect(displayed).toBeDefined();
    expect(
      isTargetHighlighted(displayed as InteractionState, {
        kind: "partOccurrence",
        partOccurrenceId: "1/0/0",
      }),
    ).toBe(true);
    expect(
      isTargetHighlighted(displayed as InteractionState, {
        kind: "partOccurrence",
        partOccurrenceId: "1/0/0/0",
      }),
    ).toBe(true);
    expect(
      isTargetHighlighted(displayed as InteractionState, {
        kind: "partOccurrence",
        partOccurrenceId: "sibling",
      }),
    ).toBe(false);

    clearHierarchyHover(owner, assembly);
    applyDisplayedInteraction(owner);
    expect(
      isTargetHighlighted(displayed as InteractionState, {
        kind: "partOccurrence",
        partOccurrenceId: "1/0/0",
      }),
    ).toBe(true);
  });
});
