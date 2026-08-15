import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  emphasizedElementBlockRefs,
  isElementBlockEmphasized,
  isElementBlockVisible,
  isTargetHighlighted,
  isTargetSelected,
  resolveElementBlockStyle,
  selectedTargets,
  setElementBlockHighlighted,
  setElementBlockOverride,
  setElementBlockSelected,
  setElementBlockVisible,
  setTargetHovered,
} from "../../src/index";
import { identity } from "../../src/math/mat4";

const instance = {
  index: 0,
  instanceId: "assembly/0",
  partId: 4,
  worldTransform: identity(),
} as const;

const base = {
  color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  emissive: 0,
  opacity: 1,
  lineWidthPixels: 2,
  edge: false,
  nodes: false,
} as const;

describe("element-block interaction", () => {
  it("keeps selection, highlight, visibility, and overrides occurrence-scoped", () => {
    const first = { instanceId: "assembly/0", blockId: 7 } as const;
    const repeated = { instanceId: "assembly/1", blockId: 7 } as const;
    let state = createInteractionState();
    state = setElementBlockSelected(state, first, true);
    state = setElementBlockHighlighted(state, first, true);
    state = setElementBlockVisible(state, first, false);
    state = setElementBlockOverride(state, first, { emissive: 0.8 });

    expect(isElementBlockVisible(state, first)).toBe(false);
    expect(isElementBlockVisible(state, repeated)).toBe(true);
    expect(isElementBlockEmphasized(state, first)).toBe(true);
    expect(isElementBlockEmphasized(state, repeated)).toBe(false);
    expect(isTargetSelected(state, { kind: "block", ...first })).toBe(true);
    expect(isTargetHighlighted(state, { kind: "block", ...first })).toBe(true);
    expect(resolveElementBlockStyle(instance, 7, base, state).emissive).toBe(0.8);
  });

  it("applies hover and selection through the ordinary target path", () => {
    const target = { kind: "block", instanceId: "assembly/0", blockId: 3 } as const;
    let state = setElementBlockSelected(createInteractionState(), target, true);
    state = setTargetHovered(state, target);
    expect(isTargetSelected(state, target)).toBe(true);
    expect(isTargetHighlighted(state, target)).toBe(false);
    expect(resolveElementBlockStyle(instance, 3, base, state).emissive).toBeGreaterThan(0);
  });

  it("orders selected block occurrences deterministically and prunes them", () => {
    let state = createInteractionState();
    state = setElementBlockSelected(state, { instanceId: "z", blockId: 2 }, true);
    state = setElementBlockSelected(state, { instanceId: "a", blockId: 9 }, true);
    state = setElementBlockSelected(state, { instanceId: "a", blockId: 1 }, true);
    expect(selectedTargets(state)).toEqual([
      { kind: "block", instanceId: "a", blockId: 1 },
      { kind: "block", instanceId: "a", blockId: 9 },
      { kind: "block", instanceId: "z", blockId: 2 },
    ]);
    const cleared = setElementBlockSelected(state, { instanceId: "a", blockId: 1 }, false);
    expect(selectedTargets(cleared)).toEqual([
      { kind: "block", instanceId: "a", blockId: 9 },
      { kind: "block", instanceId: "z", blockId: 2 },
    ]);
  });

  it("keeps hidden blocks ahead of block overrides", () => {
    let state = createInteractionState();
    state = setElementBlockVisible(state, { instanceId: "y", blockId: 2 }, false);
    state = setElementBlockOverride(state, { instanceId: "b", blockId: 3 }, { opacity: 0.5 });
    expect(emphasizedElementBlockRefs(state)).toEqual([
      { instanceId: "y", blockId: 2 },
      { instanceId: "b", blockId: 3 },
    ]);
  });
});
