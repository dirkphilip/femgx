import { describe, expect, it } from "vitest";
import type { SceneRuntime } from "../../src/entries/runtime";
import type { Viewport, InteractionState } from "../../src/entries/root";
import { createInteractionState, setInstanceHighlighted } from "../../src/interaction/interaction";
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
          occurrenceId: "1/0",
          assemblyId: 1,
          parentId: undefined,
          childIds: ["1/0/0"],
          instanceIds: ["1/0/0"],
          visible: true,
          effectiveVisible: true,
        },
      ],
      [
        "1/0/0",
        {
          occurrenceId: "1/0/0",
          assemblyId: 2,
          parentId: "1/0",
          childIds: [],
          instanceIds: ["1/0/0/0", "1/0/0/1"],
          visible: true,
          effectiveVisible: true,
        },
      ],
    ]);
    const visibleInstances = new Set(["1/0/0", "1/0/0/1"]);
    const runtime = {
      getOccurrence: (id: string) => occurrences.get(id),
      isInstanceVisible: (id: string) => visibleInstances.has(id),
    } as unknown as SceneRuntime;

    expect(interactionTargetsForRow(runtime, { kind: "assembly", occurrenceId: "1/0" })).toEqual([
      { kind: "instance", instanceId: "1/0/0" },
      { kind: "instance", instanceId: "1/0/0/1" },
    ]);
    expect(interactionTargetsForRow(runtime, { kind: "instance", instanceId: "1/1/0" })).toEqual([
      { kind: "instance", instanceId: "1/1/0" },
    ]);
    expect(
      interactionTargetsForRow(runtime, { kind: "body", instanceId: "1/0/0", bodyId: 4 }),
    ).toEqual([{ kind: "body", instanceId: "1/0/0", bodyId: 4 }]);
  });

  it("compares row identity so stale leave events cannot clear a newer row", () => {
    const body = { kind: "body", instanceId: "1/0/0", bodyId: 4 } as const;
    expect(visibilityRowTargetsEqual(body, { ...body })).toBe(true);
    expect(visibilityRowTargetsEqual(body, { kind: "body", instanceId: "1/0/0", bodyId: 5 })).toBe(
      false,
    );
    expect(visibilityRowTargetsEqual(body, { kind: "instance", instanceId: "1/0/0" })).toBe(false);
  });

  it("derives assembly emphasis without erasing persistent highlights", () => {
    const occurrences = new Map([
      [
        "1/0",
        {
          occurrenceId: "1/0",
          assemblyId: 1,
          parentId: undefined,
          childIds: ["1/0/0"],
          instanceIds: ["1/0/0"],
          visible: true,
          effectiveVisible: true,
        },
      ],
      [
        "1/0/0",
        {
          occurrenceId: "1/0/0",
          assemblyId: 2,
          parentId: "1/0",
          childIds: [],
          instanceIds: ["1/0/0/0"],
          visible: true,
          effectiveVisible: true,
        },
      ],
    ]);
    const runtime = {
      getOccurrence: (id: string) => occurrences.get(id),
      isInstanceVisible: () => true,
    } as unknown as SceneRuntime;
    let displayed: InteractionState | undefined;
    const viewport = {
      runtime,
      setInteraction: (state: InteractionState) => {
        displayed = state;
      },
    } as unknown as Viewport;
    const owner = {
      disposed: false,
      hoverOwner: undefined,
      interaction: setInstanceHighlighted(createInteractionState(), "1/0/0", true),
      viewportSlots: { clearHover: () => undefined },
      render: () => undefined,
      viewports: () => [viewport],
    } as WorkbenchHoverController;
    const assembly = { kind: "assembly", occurrenceId: "1/0" } as const;

    setHierarchyHover(owner, assembly);
    applyDisplayedInteraction(owner);
    expect(displayed).toBeDefined();
    expect(
      isTargetHighlighted(displayed as InteractionState, { kind: "instance", instanceId: "1/0/0" }),
    ).toBe(true);
    expect(
      isTargetHighlighted(displayed as InteractionState, {
        kind: "instance",
        instanceId: "1/0/0/0",
      }),
    ).toBe(true);
    expect(
      isTargetHighlighted(displayed as InteractionState, {
        kind: "instance",
        instanceId: "sibling",
      }),
    ).toBe(false);

    clearHierarchyHover(owner, assembly);
    applyDisplayedInteraction(owner);
    expect(
      isTargetHighlighted(displayed as InteractionState, { kind: "instance", instanceId: "1/0/0" }),
    ).toBe(true);
  });
});
