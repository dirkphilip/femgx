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
      boxSelectionStrategy: "visible-surface" as const,
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

  it("falls back to Visible when Through is requested outside Element granularity", () => {
    for (const selectionGranularity of ["body", "face"] as const) {
      const owner = {
        boxSelectionStrategy: "through-intersection" as const,
        selectionGranularity,
      } as unknown as Parameters<typeof normalizeBoxSelectionStrategyForGranularity>[0];

      normalizeBoxSelectionStrategyForGranularity(owner);

      expect(owner.boxSelectionStrategy).toBe("visible-surface");
    }
  });
});
