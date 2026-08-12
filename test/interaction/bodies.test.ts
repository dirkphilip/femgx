import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  resolveBodyStyle,
  setInstanceOverride,
  setPartOverride,
  type ResolvedStyle,
} from "../../src/interaction/interaction";
import {
  emphasizedBodyRefs,
  isBodyEmphasized,
  isBodyVisible,
  setBodyHighlighted,
  setBodyOverride,
  setBodySelected,
  setBodyVisible,
  setHoveredBody,
} from "../../src/interaction/bodies";
import { readInteractionState } from "../../src/interaction/state";
import { identity } from "../../src/math/mat4";
import type { Instance } from "../../src/scene/types";

const base: ResolvedStyle = {
  color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  emissive: 0,
  opacity: 1,
  edge: false,
};
const item: Instance = { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() };
const ref = { instanceId: "1/0", bodyId: 3 } as const;

describe("body interaction state", () => {
  it("tracks body selection, highlight, hover, override, and visibility immutably", () => {
    const initial = createInteractionState();
    let state = setBodySelected(initial, ref, true);
    state = setBodyHighlighted(state, ref, true);
    state = setHoveredBody(state, ref);
    state = setBodyOverride(state, ref, { opacity: 0.5 });
    state = setBodyVisible(state, ref, false);

    const initialData = readInteractionState(initial);
    const data = readInteractionState(state);
    expect(initialData.selectedBodyIds.size).toBe(0);
    expect(data.selectedBodyIds.get("1/0")).toEqual(new Set([3]));
    expect(data.highlightedBodyIds.get("1/0")).toEqual(new Set([3]));
    expect(data.bodyOverrides.get("1/0")?.get(3)).toEqual({ opacity: 0.5 });
    expect(data.hoveredTarget).toEqual({ kind: "body", ...ref });
    expect(isBodyVisible(state, ref)).toBe(false);
    expect(isBodyEmphasized(state, ref)).toBe(true);
  });

  it("collects body refs deterministically and clears the last state", () => {
    let state = createInteractionState();
    state = setBodySelected(state, { instanceId: "2/0", bodyId: 9 }, true);
    state = setBodyHighlighted(state, ref, true);
    state = setBodyVisible(state, ref, false);
    expect(emphasizedBodyRefs(state)).toEqual([ref, { instanceId: "2/0", bodyId: 9 }]);
    const cleared = setBodyVisible(state, ref, true);
    expect(readInteractionState(cleared).hiddenBodyIds.get("1/0")).toBeUndefined();
  });
});

describe("resolveBodyStyle", () => {
  it("applies body state after instance state and explicit body overrides last", () => {
    let state = createInteractionState();
    state = setPartOverride(state, 1, { color: { r: 0, g: 0, b: 0, a: 1 } });
    state = setInstanceOverride(state, "1/0", { emissive: 0.1 });
    state = setBodySelected(state, ref, true);
    state = setBodyOverride(state, ref, { opacity: 0.25, emissive: 0.05 });
    expect(resolveBodyStyle(item, 3, base, state)).toEqual({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      emissive: 0.05,
      opacity: 0.25,
      edge: false,
    });
  });

  it("uses body highlight and hover themes in deterministic order", () => {
    let state = createInteractionState();
    state = setBodyHighlighted(state, ref, true);
    state = setHoveredBody(state, ref);
    expect(resolveBodyStyle(item, 3, base, state)).toMatchObject({ emissive: 0.2 });
  });
});
