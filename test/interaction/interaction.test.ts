import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  emphasizedElementRefs,
  resolveElementStyle,
  resolveInstanceStyle,
  setElementOverride,
  setElementSelected,
  setHoveredElement,
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
import type { ElementRef, Instance } from "../../src/scene/types";

const base: ResolvedStyle = {
  color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  emissive: 0,
  opacity: 1,
  edge: false,
};
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
      selected: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 }, emissive: 0.06 },
      hovered: { emissive: 0.2 },
      hoveredFace: { emissive: 0.3 },
      selectedFace: { color: { r: 0.45, g: 1, b: 0.4, a: 1 }, emissive: 0.5 },
      hoveredNode: { emissive: 0.45 },
      selectedNode: { color: { r: 1, g: 0.42, b: 0.12, a: 1 }, emissive: 0.7 },
    });
  });

  it("keeps the provided theme", () => {
    const theme = {
      highlighted: { emissive: 0.9 },
      selected: { color: { r: 1, g: 0, b: 0, a: 1 } },
      hovered: { opacity: 0.4 },
      hoveredFace: { emissive: 0.9 },
      selectedFace: { color: { r: 1, g: 0, b: 0, a: 1 } },
      hoveredNode: { emissive: 0.9 },
      selectedNode: { color: { r: 1, g: 0, b: 0, a: 1 } },
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
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      emissive: 0.06,
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
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({ emissive: 0.06 });
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
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      emissive: 0.1,
      opacity: 0.25,
      edge: false,
    });
  });

  it("resolves the edge overlay flag from part and instance overrides", () => {
    const partEdge = setPartOverride(createInteractionState(), 1, { edge: true });
    expect(resolveInstanceStyle(item, base, partEdge)).toMatchObject({ edge: true });
    const instanceEdge = setInstanceOverride(createInteractionState(), "1/0", { edge: true });
    expect(resolveInstanceStyle(item, base, instanceEdge)).toMatchObject({ edge: true });
    const cleared = setInstanceOverride(
      setPartOverride(createInteractionState(), 1, { edge: true }),
      "1/0",
      { edge: false },
    );
    expect(resolveInstanceStyle(item, base, cleared)).toMatchObject({ edge: false });
    expect(resolveInstanceStyle(item, base, createInteractionState())).toMatchObject({
      edge: false,
    });
  });

  it("ignores state that targets other parts or instances", () => {
    expect(resolveInstanceStyle(other, base, filledState())).toBe(base);
  });
});

describe("setElementSelected", () => {
  const ref: ElementRef = { instanceId: "1/0", elementId: 3 };

  it("selects an element immutably", () => {
    const initial = createInteractionState();
    const state = setElementSelected(initial, ref, true);
    expect(initial.selectedElementIds.size).toBe(0);
    expect(state.selectedElementIds.get("1/0")).toEqual(new Set([3]));
    expect(state).not.toBe(initial);
  });

  it("deselects an element immutably", () => {
    const state = setElementSelected(createInteractionState(), ref, true);
    const cleared = setElementSelected(state, ref, false);
    expect(state.selectedElementIds.get("1/0")).toEqual(new Set([3]));
    expect(cleared.selectedElementIds.size).toBe(0);
    expect(cleared).not.toBe(state);
  });

  it("keeps sibling elements selected in the same instance", () => {
    const state = setElementSelected(createInteractionState(), ref, true);
    const withSibling = setElementSelected(state, { instanceId: "1/0", elementId: 4 }, true);
    expect(withSibling.selectedElementIds.get("1/0")).toEqual(new Set([3, 4]));
    expect(setElementSelected(withSibling, ref, false).selectedElementIds.get("1/0")).toEqual(
      new Set([4]),
    );
  });

  it("repeats are no-ops", () => {
    const state = setElementSelected(createInteractionState(), ref, true);
    expect(setElementSelected(state, ref, true)).toBe(state);
    const initial = createInteractionState();
    expect(setElementSelected(initial, ref, false)).toBe(initial);
  });
});

describe("setHoveredElement", () => {
  const ref: ElementRef = { instanceId: "1/0", elementId: 2 };

  it("sets the hovered element immutably", () => {
    const initial = createInteractionState();
    const state = setHoveredElement(initial, ref);
    expect(initial).not.toHaveProperty("hoveredElement");
    expect(state.hoveredElement).toEqual(ref);
    expect(state).not.toBe(initial);
  });

  it("replaces the current hover", () => {
    const next: ElementRef = { instanceId: "1/0", elementId: 5 };
    const state = setHoveredElement(setHoveredElement(createInteractionState(), ref), next);
    expect(state.hoveredElement).toEqual(next);
  });

  it("clears hover and drops the optional property", () => {
    const hovered = setHoveredElement(createInteractionState(), ref);
    const cleared = setHoveredElement(hovered, undefined);
    expect(hovered.hoveredElement).toEqual(ref);
    expect(cleared).not.toHaveProperty("hoveredElement");
    expect(cleared).not.toBe(hovered);
  });

  it("repeats are no-ops", () => {
    const state = setHoveredElement(createInteractionState(), ref);
    expect(setHoveredElement(state, ref)).toBe(state);
    const initial = createInteractionState();
    expect(setHoveredElement(initial, undefined)).toBe(initial);
  });
});

describe("setElementOverride", () => {
  const ref: ElementRef = { instanceId: "1/0", elementId: 1 };

  it("sets, replaces, and clears an override immutably", () => {
    const initial = createInteractionState();
    const set = setElementOverride(initial, ref, { color: { r: 1, g: 0, b: 0, a: 1 } });
    const replaced = setElementOverride(set, ref, { opacity: 0.5 });
    const cleared = setElementOverride(replaced, ref, undefined);
    expect(initial.elementOverrides.size).toBe(0);
    expect(set.elementOverrides.get("1/0")?.get(1)).toMatchObject({
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    expect(replaced.elementOverrides.get("1/0")?.get(1)).toMatchObject({ opacity: 0.5 });
    expect(cleared.elementOverrides.size).toBe(0);
    expect(set).not.toBe(initial);
    expect(cleared).not.toBe(replaced);
  });

  it("keeps overrides for sibling elements", () => {
    const state = setElementOverride(createInteractionState(), ref, { emissive: 0.9 });
    const withSibling = setElementOverride(
      state,
      { instanceId: "1/0", elementId: 2 },
      { emissive: 0.2 },
    );
    expect(withSibling.elementOverrides.get("1/0")?.size).toBe(2);
    expect(setElementOverride(withSibling, ref, undefined).elementOverrides.get("1/0")?.size).toBe(
      1,
    );
  });
});

describe("resolveElementStyle", () => {
  it("applies element hover over the base instance style", () => {
    const state = setHoveredElement(createInteractionState(), { instanceId: "1/0", elementId: 2 });
    expect(resolveElementStyle(item, 2, base, state)).toMatchObject({ emissive: 0.2 });
    expect(resolveElementStyle(item, 3, base, state)).toBe(base);
  });

  it("applies element selection over hover", () => {
    const state = setElementSelected(
      setHoveredElement(createInteractionState(), { instanceId: "1/0", elementId: 2 }),
      { instanceId: "1/0", elementId: 2 },
      true,
    );
    expect(resolveElementStyle(item, 2, base, state)).toMatchObject({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      emissive: 0.06,
    });
  });

  it("gives explicit element overrides precedence over selection", () => {
    const state = setElementOverride(
      setElementSelected(createInteractionState(), { instanceId: "1/0", elementId: 2 }, true),
      { instanceId: "1/0", elementId: 2 },
      { emissive: 0.1 },
    );
    expect(resolveElementStyle(item, 2, base, state)).toMatchObject({ emissive: 0.1 });
  });

  it("still applies part and instance state to elements", () => {
    const state = setPartSelected(
      setInstanceSelected(createInteractionState(), "1/0", true),
      1,
      true,
    );
    expect(resolveElementStyle(item, 9, base, state)).toMatchObject({ emissive: 0.06 });
  });
});

describe("emphasizedElementRefs", () => {
  it("collects hovered, selected, and overridden elements without duplicates", () => {
    let state = createInteractionState();
    state = setElementSelected(state, { instanceId: "1/0", elementId: 1 }, true);
    state = setElementSelected(state, { instanceId: "1/0", elementId: 2 }, true);
    state = setElementSelected(state, { instanceId: "2/0", elementId: 1 }, true);
    state = setElementOverride(state, { instanceId: "1/0", elementId: 2 }, { emissive: 0.5 });
    state = setHoveredElement(state, { instanceId: "3/0", elementId: 7 });
    expect(emphasizedElementRefs(state)).toEqual([
      { instanceId: "3/0", elementId: 7 },
      { instanceId: "1/0", elementId: 1 },
      { instanceId: "1/0", elementId: 2 },
      { instanceId: "2/0", elementId: 1 },
    ]);
  });

  it("returns no refs for an empty state", () => {
    expect(emphasizedElementRefs(createInteractionState())).toEqual([]);
  });
});
