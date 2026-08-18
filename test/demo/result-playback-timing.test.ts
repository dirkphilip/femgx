import { describe, expect, it, vi } from "vitest";
import { createResultsPreset } from "../../demo/fixtures/results-preset";
import { createExampleModel } from "../../demo/workbench/models/model";
import { createResultPlaybackActions } from "../../demo/workbench/results/result-playback";
import { createWorkbenchShowState } from "../../demo/workbench/state/show-state";

describe("demo result playback timing", () => {
  it("anchors playback cadence to elapsed time instead of application work", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const model = createExampleModel(createResultsPreset());
      const state = createWorkbenchShowState(model);
      let simulateWork = false;
      const applied: number[] = [];
      const owner = {
        model,
        activeSlot: () => ({ id: "primary" as const }),
        showState: () => state,
        applyResultModeForSlot: () => {
          applied.push(Date.now());
          if (simulateWork) vi.setSystemTime(Date.now() + 200);
        },
        disposed: false,
        publishSnapshot: () => undefined,
      };
      const actions = createResultPlaybackActions(owner);

      actions.togglePlaying();
      simulateWork = true;
      vi.advanceTimersByTime(1000);
      expect(actions.snapshot()?.index).toBe(1);
      vi.advanceTimersByTime(799);
      expect(actions.snapshot()?.index).toBe(1);
      vi.advanceTimersByTime(1);

      expect(actions.snapshot()?.index).toBe(2);
      expect(applied).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops and applies a manual step with one publication while playing", () => {
    vi.useFakeTimers();
    try {
      const model = createExampleModel(createResultsPreset());
      const state = createWorkbenchShowState(model);
      const applied: number[] = [];
      const published: number[] = [];
      const owner = {
        model,
        activeSlot: () => ({ id: "primary" as const }),
        showState: () => state,
        applyResultModeForSlot: () => {
          applied.push(state.resultPlaybackIndex);
          published.push(state.resultPlaybackIndex);
        },
        disposed: false,
        publishSnapshot: () => published.push(state.resultPlaybackIndex),
      };
      const actions = createResultPlaybackActions(owner);

      actions.togglePlaying();
      applied.length = 0;
      published.length = 0;
      actions.next();

      expect(state.resultPlaybackPlaying).toBe(false);
      expect(state.resultPlaybackIndex).toBe(1);
      expect(applied).toEqual([1]);
      expect(published).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reapply or publish when stepping at a clamped boundary", () => {
    const model = createExampleModel(createResultsPreset());
    const state = createWorkbenchShowState(model);
    const applied: number[] = [];
    const published: number[] = [];
    const owner = {
      model,
      activeSlot: () => ({ id: "primary" as const }),
      showState: () => state,
      applyResultModeForSlot: () => applied.push(state.resultPlaybackIndex),
      disposed: false,
      publishSnapshot: () => published.push(state.resultPlaybackIndex),
    };
    const actions = createResultPlaybackActions(owner);

    actions.setIndex("3");
    applied.length = 0;
    published.length = 0;
    actions.next();
    expect(state.resultPlaybackIndex).toBe(3);
    expect(applied).toEqual([]);
    expect(published).toEqual([]);

    actions.setIndex("0");
    applied.length = 0;
    published.length = 0;
    actions.previous();
    expect(state.resultPlaybackIndex).toBe(0);
    expect(applied).toEqual([]);
    expect(published).toEqual([]);
  });
});
