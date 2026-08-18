import { describe, expect, it, vi } from "vitest";
import {
  normalizeBoxSelectionStrategyForGranularity,
  setBoxSelectionStrategy,
} from "../../demo/workbench/controllers/controller-box-selection";

describe("workbench box-selection strategy", () => {
  it("installs the shared resolver and invalidates both strategy changes and slot additions", () => {
    const setResolver = vi.fn();
    const render = vi.fn();
    const owner = {
      boxSelectionStrategy: "through-intersection" as const,
      elementBoxSelectionStrategy: "through-intersection" as const,
      selectionGranularity: "element" as const,
      viewportSlots: {
        all: () => [{ viewport: {}, interaction: { setBoxSelectionResolver: setResolver } }],
      },
      render,
    } as unknown as Parameters<typeof setBoxSelectionStrategy>[0];

    setBoxSelectionStrategy(owner, "through-intersection");

    expect(owner.boxSelectionStrategy).toBe("through-intersection");
    expect(setResolver).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("uses Visible outside Element while restoring the last Element strategy", () => {
    for (const selectionGranularity of ["part", "partOccurrence", "body", "face"] as const) {
      const owner = {
        boxSelectionStrategy: "through-intersection" as const,
        elementBoxSelectionStrategy: "through-intersection" as const,
        selectionGranularity,
      } as unknown as Parameters<typeof normalizeBoxSelectionStrategyForGranularity>[0];

      normalizeBoxSelectionStrategyForGranularity(owner);

      expect(owner.boxSelectionStrategy).toBe("visible-surface");
      (owner as { selectionGranularity: "element" }).selectionGranularity = "element";
      normalizeBoxSelectionStrategyForGranularity(owner);
      expect(owner.boxSelectionStrategy).toBe("through-intersection");
    }
  });

  it("propagates the shared Element strategy to every viewport slot", () => {
    const primaryResolver = vi.fn();
    const secondaryResolver = vi.fn();
    const states = new Map([
      [
        "primary" as const,
        {
          boxSelectionStrategy: "through-intersection" as const,
          elementBoxSelectionStrategy: "through-intersection" as const,
          selectionGranularity: "element" as const,
        },
      ],
      [
        "secondary" as const,
        {
          boxSelectionStrategy: "through-intersection" as const,
          elementBoxSelectionStrategy: "through-intersection" as const,
          selectionGranularity: "element" as const,
        },
      ],
    ]);
    const owner = {
      boxSelectionStrategy: "through-intersection" as const,
      elementBoxSelectionStrategy: "through-intersection" as const,
      selectionGranularity: "element" as const,
      showState: (slotId: "primary" | "secondary") => states.get(slotId),
      viewportSlots: {
        all: () => [
          {
            id: "primary" as const,
            viewport: {},
            interaction: { setBoxSelectionResolver: primaryResolver },
          },
          {
            id: "secondary" as const,
            viewport: {},
            interaction: { setBoxSelectionResolver: secondaryResolver },
          },
        ],
      },
      render: vi.fn(),
    } as unknown as Parameters<typeof setBoxSelectionStrategy>[0];

    setBoxSelectionStrategy(owner, "visible-surface");

    expect(states.get("primary")?.boxSelectionStrategy).toBe("visible-surface");
    expect(states.get("secondary")?.boxSelectionStrategy).toBe("visible-surface");
    expect(states.get("primary")?.elementBoxSelectionStrategy).toBe("visible-surface");
    expect(states.get("secondary")?.elementBoxSelectionStrategy).toBe("visible-surface");
    expect(primaryResolver).toHaveBeenCalledOnce();
    expect(secondaryResolver).toHaveBeenCalledOnce();
  });
});
