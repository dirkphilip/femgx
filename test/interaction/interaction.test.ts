import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  emphasizedElementRefs,
  resolveElementStyle,
  resolveInstanceStyle,
  setElementOverride,
  setInstanceOverride,
  setPartOverride,
  type InteractionState,
  type ResolvedStyle,
  type StyleOverride,
} from "../../src/interaction/interaction";
import {
  hoveredTarget,
  isTargetSelected,
  setTargetHovered,
  setTargetSelected,
} from "../../src/interaction/targets";
import { readInteractionState } from "../../src/interaction/state";
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
  state = setTargetSelected(state, { kind: "part", partId: 1 }, true);
  state = setTargetSelected(state, { kind: "instance", instanceId: "1/0" }, true);
  state = setTargetHovered(state, { kind: "instance", instanceId: "1/0" });
  state = setPartOverride(state, 1, { emissive: 0.1 });
  state = setInstanceOverride(state, "1/0", { opacity: 0.25 });
  return state;
}

describe("opaque interaction state", () => {
  it("does not expose its storage fields", () => {
    const state = createInteractionState();
    expect(Object.keys(state)).toEqual([]);
    expect(state).not.toHaveProperty("selectedPartIds");
    const data = readInteractionState(state);
    expect(data.selectedPartIds).toEqual(new Set());
    expect(data.theme.selected).toEqual({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      emissive: 0.06,
    });
  });

  it("keeps the supplied theme by reference", () => {
    const theme = {
      highlighted: { emissive: 0.9 },
      selected: { color: { r: 1, g: 0, b: 0, a: 1 } },
      hovered: { opacity: 0.4 },
      hoveredFace: { emissive: 0.9 },
      selectedFace: { color: { r: 1, g: 0, b: 0, a: 1 } },
      hoveredNode: { emissive: 0.9 },
      selectedNode: { color: { r: 1, g: 0, b: 0, a: 1 } },
    };
    expect(readInteractionState(createInteractionState(theme)).theme).toBe(theme);
  });

  it("keeps no-op target updates referentially stable", () => {
    const initial = createInteractionState();
    const selected = setTargetSelected(initial, { kind: "part", partId: 1 }, true);
    expect(setTargetSelected(selected, { kind: "part", partId: 1 }, true)).toBe(selected);
    expect(setTargetSelected(initial, { kind: "part", partId: 1 }, false)).toBe(initial);
    const hovered = setTargetHovered(initial, { kind: "instance", instanceId: "1/0" });
    expect(setTargetHovered(hovered, { kind: "instance", instanceId: "1/0" })).toBe(hovered);
    expect(setTargetHovered(hovered, undefined)).not.toBe(hovered);
    expect(hoveredTarget(setTargetHovered(hovered, undefined))).toBeUndefined();
  });

  it("supports every target kind through the same selection query", () => {
    const targets = [
      { kind: "part", partId: 1 },
      { kind: "instance", instanceId: "1/0" },
      { kind: "body", instanceId: "1/0", bodyId: 2 },
      { kind: "element", instanceId: "1/0", elementId: 3 },
      { kind: "face", instanceId: "1/0", elementId: 3, key: "0,1,2" },
      { kind: "node", instanceId: "1/0", nodeId: 4 },
    ] as const;
    for (const target of targets) {
      const state = setTargetSelected(createInteractionState(), target, true);
      expect(isTargetSelected(state, target)).toBe(true);
      expect(isTargetSelected(setTargetSelected(state, target, false), target)).toBe(false);
    }
  });
});

describe("instance style resolution", () => {
  it("returns the base style for an empty state", () => {
    expect(resolveInstanceStyle(item, base, createInteractionState())).toBe(base);
  });

  it("applies selected, hover, and explicit overrides in precedence order", () => {
    expect(
      resolveInstanceStyle(
        item,
        base,
        setTargetSelected(createInteractionState(), { kind: "instance", instanceId: "1/0" }, true),
      ),
    ).toMatchObject({ color: { r: 0.95, g: 0.5, b: 0.1, a: 1 }, emissive: 0.06 });
    const hovered = setTargetHovered(createInteractionState(), {
      kind: "instance",
      instanceId: "1/0",
    });
    expect(resolveInstanceStyle(item, base, hovered)).toMatchObject({ emissive: 0.2 });
    expect(resolveInstanceStyle(other, base, filledState())).toBe(base);
    const override = setPartOverride(
      setInstanceOverride(createInteractionState(), "1/0", { opacity: 0.25 }),
      1,
      { color: { r: 0, g: 0, b: 0, a: 1 } },
    );
    expect(resolveInstanceStyle(item, base, override)).toMatchObject({
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 0.25,
    });
  });
});

describe("element interaction", () => {
  const ref: ElementRef = { instanceId: "1/0", elementId: 2 };

  it("preserves nested immutable collections and explicit override precedence", () => {
    const selected = setTargetSelected(createInteractionState(), { kind: "element", ...ref }, true);
    const data = readInteractionState(selected);
    expect(data.selectedElementIds.get("1/0")).toEqual(new Set([2]));
    const withOverride = setElementOverride(selected, ref, { emissive: 0.8 });
    expect(resolveElementStyle(item, 2, base, withOverride)).toMatchObject({ emissive: 0.8 });
    expect(setElementOverride(withOverride, ref, undefined)).not.toBe(withOverride);
  });

  it("collects hovered, selected, and overridden elements without duplicates", () => {
    let state = setTargetSelected(createInteractionState(), { kind: "element", ...ref }, true);
    state = setElementOverride(state, ref, { emissive: 0.5 });
    state = setTargetHovered(state, { kind: "element", ...ref });
    expect(emphasizedElementRefs(state)).toEqual([ref]);
  });

  it("keeps override references stable for repeated writes", () => {
    const override: StyleOverride = { opacity: 0.5 };
    const state = setElementOverride(createInteractionState(), ref, override);
    expect(setElementOverride(state, ref, override)).toBe(state);
  });
});
