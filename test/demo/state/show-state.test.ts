import { describe, expect, it } from "vitest";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createExampleModel } from "../../../demo/workbench/models/model";
import {
  cloneShowStateForSlot,
  createWorkbenchShowState,
  installWorkbenchShowStateAccessors,
  resetShowStatesForModel,
} from "../../../demo/workbench/state/show-state";

describe("workbench viewport show state", () => {
  it("clones the active presentation once without sharing mutable controls", () => {
    const model = createExampleModel(createBoltedPlatePreset());
    const primary = createWorkbenchShowState(model);
    primary.toggles.edges = false;
    primary.selectionGranularity = "node";
    const states = new Map<"primary" | "secondary", ReturnType<typeof createWorkbenchShowState>>([
      ["primary", primary],
    ]);
    const hoverOwners = new Map<"primary" | "secondary", undefined>();

    cloneShowStateForSlot(states, hoverOwners, "primary", "secondary");

    const secondary = states.get("secondary");
    expect(secondary).toBeDefined();
    expect(secondary?.toggles).toEqual(primary.toggles);
    expect(secondary?.selectionGranularity).toBe("node");
    if (secondary === undefined) throw new Error("secondary state was not created");

    secondary.toggles.edges = true;
    secondary.selectionGranularity = "face";
    expect(primary.toggles.edges).toBe(false);
    expect(primary.selectionGranularity).toBe("node");
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
