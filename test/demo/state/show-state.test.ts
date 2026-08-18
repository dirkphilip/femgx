import { describe, expect, it, vi } from "vitest";
import { createResultsPreset } from "../../../demo/fixtures/results-preset";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createExampleModel } from "../../../demo/workbench/models/model";
import { createResultPlaybackActions } from "../../../demo/workbench/results/result-playback";
import {
  clearResultPlaybackTimers,
  cloneShowStateForSlot,
  createWorkbenchShowState,
  installWorkbenchShowStateAccessors,
  resetShowStatesForModel,
} from "../../../demo/workbench/state/show-state";

describe("workbench viewport show state", () => {
  it("starts authored playback available but inactive for every model slot", () => {
    const model = createExampleModel(createResultsPreset());
    const state = createWorkbenchShowState(model);

    expect(state.resultPlaybackIndex).toBe(0);
    expect(state.resultPlaybackPlaying).toBe(false);
    expect(state.resultPlaybackActive).toBe(false);
    expect(state.boxSelectionStrategy).toBe("through-intersection");
    expect(state.elementBoxSelectionStrategy).toBe("through-intersection");

    const states = new Map([["primary" as const, state]]);
    resetShowStatesForModel(states, new Map(), model);
    expect(states.get("primary")?.resultPlaybackActive).toBe(false);
  });

  it("clones the active presentation once without sharing mutable controls", () => {
    const model = createExampleModel(createBoltedPlatePreset());
    const primary = createWorkbenchShowState(model);
    primary.toggles.edges = false;
    primary.selectionGranularity = "node";
    primary.resultPlaybackActive = true;
    primary.resultPlaybackPlaying = true;
    const states = new Map<"primary" | "secondary", ReturnType<typeof createWorkbenchShowState>>([
      ["primary", primary],
    ]);
    const hoverOwners = new Map<"primary" | "secondary", undefined>();

    cloneShowStateForSlot(states, hoverOwners, "primary", "secondary");

    const secondary = states.get("secondary");
    expect(secondary).toBeDefined();
    expect(secondary?.toggles).toEqual(primary.toggles);
    expect(secondary?.selectionGranularity).toBe("node");
    expect(secondary?.resultPlaybackActive).toBe(false);
    expect(secondary?.resultPlaybackPlaying).toBe(false);
    expect(secondary?.resultPlaybackTimer).toBeUndefined();
    if (secondary === undefined) throw new Error("secondary state was not created");

    secondary.toggles.edges = true;
    secondary.selectionGranularity = "face";
    expect(primary.toggles.edges).toBe(false);
    expect(primary.selectionGranularity).toBe("node");
  });

  it("clears pending playback timers for every viewport slot", () => {
    vi.useFakeTimers();
    try {
      const model = createExampleModel(createResultsPreset());
      const primary = createWorkbenchShowState(model);
      const secondary = createWorkbenchShowState(model);
      const states = new Map<"primary" | "secondary", ReturnType<typeof createWorkbenchShowState>>([
        ["primary", primary],
        ["secondary", secondary],
      ]);
      let activeSlot: "primary" | "secondary" = "primary";
      const actions = createResultPlaybackActions({
        model,
        activeSlot: () => ({ id: activeSlot }),
        showState: (slotId) => {
          const state = states.get(slotId);
          if (state === undefined) throw new Error(`Missing show state for ${slotId}`);
          return state;
        },
        applyResultModeForSlot: () => undefined,
        disposed: false,
        publishSnapshot: () => undefined,
      });

      actions.togglePlaying();
      activeSlot = "secondary";
      actions.togglePlaying();
      expect(primary.resultPlaybackTimer).toBeDefined();
      expect(secondary.resultPlaybackTimer).toBeDefined();
      expect(primary.resultPlaybackPlaying).toBe(true);
      expect(secondary.resultPlaybackPlaying).toBe(true);

      clearResultPlaybackTimers(states);
      vi.advanceTimersByTime(1000);

      expect(primary.resultPlaybackTimer).toBeUndefined();
      expect(secondary.resultPlaybackTimer).toBeUndefined();
      expect(primary.resultPlaybackIndex).toBe(0);
      expect(secondary.resultPlaybackIndex).toBe(0);
      expect(primary.resultPlaybackPlaying).toBe(true);
      expect(secondary.resultPlaybackPlaying).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes controller-compatible properties through the focused slot", () => {
    const model = createExampleModel(createBoltedPlatePreset());
    const states = new Map([
      ["primary" as const, createWorkbenchShowState(model)],
      ["secondary" as const, createWorkbenchShowState(model)],
    ]);
    const hoverOwners = new Map<"primary" | "secondary", undefined>();
    let active: "primary" | "secondary" = "primary";
    const owner = {} as { toggles: { edges: boolean } };
    installWorkbenchShowStateAccessors(owner, states, hoverOwners, () => active);

    owner.toggles.edges = false;
    active = "secondary";
    expect(owner.toggles.edges).toBe(true);
    owner.toggles.edges = false;
    active = "primary";
    expect(owner.toggles.edges).toBe(false);
  });

  it("preserves each viewport background when model-dependent state resets", () => {
    const model = createExampleModel(createBoltedPlatePreset());
    const replacement = createExampleModel(createBoltedPlatePreset());
    const states = new Map([
      ["primary" as const, createWorkbenchShowState(model)],
      ["secondary" as const, createWorkbenchShowState(model)],
    ]);
    const primary = states.get("primary");
    const secondary = states.get("secondary");
    if (primary === undefined || secondary === undefined) throw new Error("missing slot state");
    primary.background = "dark";
    secondary.background = "white";
    resetShowStatesForModel(states, new Map(), replacement);

    expect(states.get("primary")?.background).toBe("dark");
    expect(states.get("secondary")?.background).toBe("white");
  });
});
