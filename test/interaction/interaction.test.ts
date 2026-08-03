import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  resolveInstanceStyle,
  setHoveredInstance,
  setInstanceHighlighted,
  setInstanceOverride,
  setInstanceSelected,
  setPartHighlighted,
  setPartOverride,
  setPartSelected,
} from "../../src/interaction/interaction";
import type {
  InteractionState,
  ResolvedStyle,
  StyleOverride,
} from "../../src/interaction/interaction";
import { identity } from "../../src/math/mat4";
import type { Instance } from "../../src/scene/types";

const base: ResolvedStyle = { color: { r: 0.2, g: 0.3, b: 0.4, a: 1 }, emissive: 0, opacity: 1 };
const item: Instance = { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() };
const other: Instance = { index: 1, instanceId: "2/0", partId: 2, worldTransform: identity() };

function filledState(): InteractionState {
  let state = createInteractionState();
  state = setPartHighlighted(state, 1, true);
  state = setInstanceHighlighted(state, "1/0", true);
  state = setHoveredInstance(state, "1/0");
  state = setPartSelected(state, 1, true);
  state = setInstanceSelected(state, "1/0", true);
  state = setPartOverride(state, 1, { emissive: 0.1 });
  state = setInstanceOverride(state, "1/0", { opacity: 0.25 });
  return state;
}

describe("createInteractionState", () => {
  it("starts empty with no hovered instance", () => {
    const state = createInteractionState();
    expect(state.highlightedPartIds.size).toBe(0);
    expect(state.highlightedInstanceIds.size).toBe(0);
    expect(state.selectedPartIds.size).toBe(0);
    expect(state.selectedInstanceIds.size).toBe(0);
    expect(state.partOverrides.size).toBe(0);
    expect(state.instanceOverrides.size).toBe(0);
    expect(state).not.toHaveProperty("hoveredInstanceId");
  });

  it("uses the default theme when none is given", () => {
    expect(createInteractionState().theme).toEqual({
      highlighted: { emissive: 0.35 },
      selected: { color: { r: 1, g: 0.75, b: 0.1, a: 1 }, emissive: 0.6 },
      hovered: { emissive: 0.2 },
    });
  });

  it("keeps the provided theme", () => {
    const theme = {
      highlighted: { emissive: 0.9 },
      selected: { color: { r: 1, g: 0, b: 0, a: 1 } },
      hovered: { opacity: 0.4 },
    };
    expect(createInteractionState(theme).theme).toBe(theme);
  });
});

describe("setPartHighlighted", () => {
  it("adds a highlight immutably", () => {
    const initial = createInteractionState();
    const state = setPartHighlighted(initial, 1, true);
    expect(initial.highlightedPartIds.size).toBe(0);
    expect(state.highlightedPartIds.has(1)).toBe(true);
    expect(state).not.toBe(initial);
  });

  it("clears a highlight immutably", () => {
    const state = setPartHighlighted(createInteractionState(), 1, true);
    const cleared = setPartHighlighted(state, 1, false);
    expect(state.highlightedPartIds.has(1)).toBe(true);
    expect(cleared.highlightedPartIds.size).toBe(0);
    expect(cleared).not.toBe(state);
  });

  it("repeats are no-ops", () => {
    const state = setPartHighlighted(createInteractionState(), 1, true);
    expect(setPartHighlighted(state, 1, true)).toBe(state);
    const initial = createInteractionState();
    expect(setPartHighlighted(initial, 1, false)).toBe(initial);
  });
});

describe("setInstanceHighlighted", () => {
  it("adds and clears a highlight immutably", () => {
    const initial = createInteractionState();
    const state = setInstanceHighlighted(initial, "1/0", true);
    const cleared = setInstanceHighlighted(state, "1/0", false);
    expect(initial.highlightedInstanceIds.size).toBe(0);
    expect(state.highlightedInstanceIds.has("1/0")).toBe(true);
    expect(cleared.highlightedInstanceIds.size).toBe(0);
    expect(state).not.toBe(initial);
    expect(cleared).not.toBe(state);
  });

  it("repeats are no-ops", () => {
    const state = setInstanceHighlighted(createInteractionState(), "1/0", true);
    expect(setInstanceHighlighted(state, "1/0", true)).toBe(state);
    const initial = createInteractionState();
    expect(setInstanceHighlighted(initial, "1/0", false)).toBe(initial);
  });
});

describe("setPartSelected", () => {
  it("adds and clears a selection immutably", () => {
    const initial = createInteractionState();
    const state = setPartSelected(initial, 1, true);
    const cleared = setPartSelected(state, 1, false);
    expect(initial.selectedPartIds.size).toBe(0);
    expect(state.selectedPartIds.has(1)).toBe(true);
    expect(cleared.selectedPartIds.size).toBe(0);
    expect(state).not.toBe(initial);
    expect(cleared).not.toBe(state);
  });

  it("repeats are no-ops", () => {
    const state = setPartSelected(createInteractionState(), 1, true);
    expect(setPartSelected(state, 1, true)).toBe(state);
    const initial = createInteractionState();
    expect(setPartSelected(initial, 1, false)).toBe(initial);
  });
});

describe("setInstanceSelected", () => {
  it("adds and clears a selection immutably", () => {
    const initial = createInteractionState();
    const state = setInstanceSelected(initial, "1/0", true);
    const cleared = setInstanceSelected(state, "1/0", false);
    expect(initial.selectedInstanceIds.size).toBe(0);
    expect(state.selectedInstanceIds.has("1/0")).toBe(true);
    expect(cleared.selectedInstanceIds.size).toBe(0);
    expect(state).not.toBe(initial);
    expect(cleared).not.toBe(state);
  });

  it("repeats are no-ops", () => {
    const state = setInstanceSelected(createInteractionState(), "1/0", true);
    expect(setInstanceSelected(state, "1/0", true)).toBe(state);
    const initial = createInteractionState();
    expect(setInstanceSelected(initial, "1/0", false)).toBe(initial);
  });
});

describe("setHoveredInstance", () => {
  it("sets the hovered instance immutably", () => {
    const initial = createInteractionState();
    const state = setHoveredInstance(initial, "1/0");
    expect(initial).not.toHaveProperty("hoveredInstanceId");
    expect(state.hoveredInstanceId).toBe("1/0");
    expect(state).not.toBe(initial);
  });

  it("replaces the current hover", () => {
    const state = setHoveredInstance(setHoveredInstance(createInteractionState(), "1/0"), "2/0");
    expect(state.hoveredInstanceId).toBe("2/0");
  });

  it("clears hover and drops the optional property", () => {
    const hovered = setHoveredInstance(createInteractionState(), "1/0");
    const cleared = setHoveredInstance(hovered, undefined);
    expect(hovered.hoveredInstanceId).toBe("1/0");
    expect(cleared).not.toHaveProperty("hoveredInstanceId");
    expect(cleared).not.toBe(hovered);
  });

  it("repeats are no-ops", () => {
    const state = setHoveredInstance(createInteractionState(), "1/0");
    expect(setHoveredInstance(state, "1/0")).toBe(state);
    const initial = createInteractionState();
    expect(setHoveredInstance(initial, undefined)).toBe(initial);
  });
});

describe("setPartOverride", () => {
  it("sets, replaces, and clears an override immutably", () => {
    const initial = createInteractionState();
    const set = setPartOverride(initial, 1, { color: { r: 1, g: 0, b: 0, a: 1 } });
    const replaced = setPartOverride(set, 1, { opacity: 0.5 });
    const cleared = setPartOverride(replaced, 1, undefined);
    expect(initial.partOverrides.size).toBe(0);
    expect(set.partOverrides.get(1)).toMatchObject({ color: { r: 1, g: 0, b: 0, a: 1 } });
    expect(replaced.partOverrides.get(1)).toMatchObject({ opacity: 0.5 });
    expect(replaced.partOverrides.get(1)?.color).toBeUndefined();
    expect(cleared.partOverrides.size).toBe(0);
    expect(set).not.toBe(initial);
    expect(replaced).not.toBe(set);
    expect(cleared).not.toBe(replaced);
  });

  it("repeats with the same override reference are no-ops", () => {
    const override: StyleOverride = { opacity: 0.5 };
    const state = setPartOverride(createInteractionState(), 1, override);
    expect(setPartOverride(state, 1, override)).toBe(state);
    const initial = createInteractionState();
    expect(setPartOverride(initial, 1, undefined)).toBe(initial);
  });
});

describe("setInstanceOverride", () => {
  it("sets, replaces, and clears an override immutably", () => {
    const initial = createInteractionState();
    const set = setInstanceOverride(initial, "1/0", { emissive: 0.9 });
    const replaced = setInstanceOverride(set, "1/0", { opacity: 0.5 });
    const cleared = setInstanceOverride(replaced, "1/0", undefined);
    expect(initial.instanceOverrides.size).toBe(0);
    expect(set.instanceOverrides.get("1/0")).toMatchObject({ emissive: 0.9 });
    expect(replaced.instanceOverrides.get("1/0")).toMatchObject({ opacity: 0.5 });
    expect(replaced.instanceOverrides.get("1/0")?.emissive).toBeUndefined();
    expect(cleared.instanceOverrides.size).toBe(0);
    expect(set).not.toBe(initial);
    expect(replaced).not.toBe(set);
    expect(cleared).not.toBe(replaced);
  });

  it("repeats with the same override reference are no-ops", () => {
    const override: StyleOverride = { opacity: 0.5 };
    const state = setInstanceOverride(createInteractionState(), "1/0", override);
    expect(setInstanceOverride(state, "1/0", override)).toBe(state);
    const initial = createInteractionState();
    expect(setInstanceOverride(initial, "1/0", undefined)).toBe(initial);
  });
});

describe("resolveInstanceStyle", () => {
  it("returns the base style for an empty state", () => {
    expect(resolveInstanceStyle(item, base, createInteractionState())).toBe(base);
  });

  it("applies part and instance highlight themes while preserving base fields", () => {
    const state = setInstanceHighlighted(
      setPartHighlighted(createInteractionState(), 1, true),
      "1/0",
      true,
    );
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({
      color: base.color,
      emissive: 0.35,
      opacity: base.opacity,
    });
  });

  it("applies the hovered theme", () => {
    const state = setHoveredInstance(createInteractionState(), "1/0");
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({ emissive: 0.2 });
  });

  it("applies the selected theme for parts and instances", () => {
    const state = setInstanceSelected(
      setPartSelected(createInteractionState(), 1, true),
      "1/0",
      true,
    );
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({
      color: { r: 1, g: 0.75, b: 0.1, a: 1 },
      emissive: 0.6,
    });
  });

  it("applies explicit part and instance overrides", () => {
    const state = setPartOverride(
      setInstanceOverride(createInteractionState(), "1/0", { opacity: 0.25 }),
      1,
      { color: { r: 0, g: 0, b: 0, a: 1 } },
    );
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 0.25,
    });
  });

  it("lets later state win (selected beats hover beats highlight)", () => {
    const state = setPartHighlighted(
      setPartSelected(setHoveredInstance(createInteractionState(), "1/0"), 1, true),
      1,
      true,
    );
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({ emissive: 0.6 });
  });

  it("gives explicit overrides precedence over theme states", () => {
    const state = setPartOverride(setPartSelected(createInteractionState(), 1, true), 1, {
      emissive: 0.1,
    });
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({ emissive: 0.1 });
  });

  it("gives instance overrides precedence over part overrides", () => {
    const state = setPartOverride(
      setInstanceOverride(createInteractionState(), "1/0", { emissive: 0.05 }),
      1,
      {
        emissive: 0.1,
      },
    );
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({ emissive: 0.05 });
  });

  it("resolves the full precedence chain deterministically", () => {
    const state = filledState();
    expect(resolveInstanceStyle(item, base, state)).toEqual({
      color: { r: 1, g: 0.75, b: 0.1, a: 1 },
      emissive: 0.1,
      opacity: 0.25,
    });
  });

  it("ignores state that targets other parts or instances", () => {
    expect(resolveInstanceStyle(other, base, filledState())).toBe(base);
  });
});
