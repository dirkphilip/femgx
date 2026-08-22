import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  emphasizedElementRefs,
  resolveElementStyle,
  resolveInstanceStyle,
  setElementOverride,
  setPartOccurrenceOverride,
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
import { setBodyOverride } from "../../src/interaction/bodies";
import { readInteractionState, readInteractionVisibility } from "../../src/interaction/state";
import { isElementVisible, setElementVisible } from "../../src/interaction/elements";
import { identityMatrix } from "../../src/math/mat4";
import type { ElementRef, PartOccurrence } from "../../src/scene/types";

const base: ResolvedStyle = {
  color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  emissive: 0,
  opacity: 1,
  lineWidthPixels: 2,
  edge: false,
  nodes: false,
};
const item: PartOccurrence = {
  partOccurrenceId: "1/0",
  partId: 1,
  worldTransform: identityMatrix(),
};
const other: PartOccurrence = {
  partOccurrenceId: "2/0",
  partId: 2,
  worldTransform: identityMatrix(),
};

function filledState(): InteractionState {
  let state = createInteractionState();
  state = setTargetSelected(state, { kind: "part", partId: 1 }, true);
  state = setTargetSelected(state, { kind: "partOccurrence", partOccurrenceId: "1/0" }, true);
  state = setTargetHovered(state, { kind: "partOccurrence", partOccurrenceId: "1/0" });
  state = setPartOverride(state, 1, { emissive: 0.1 });
  state = setPartOccurrenceOverride(state, "1/0", { opacity: 0.25 });
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
    });
  });

  it("owns an immutable copy of the supplied theme", () => {
    const theme = {
      highlighted: { emissive: 0.9 },
      selected: { color: { r: 1, g: 0, b: 0, a: 1 } },
    };
    const stored = readInteractionState(createInteractionState(theme)).theme;
    expect(stored).toEqual(theme);
    expect(stored).not.toBe(theme);
    theme.highlighted.emissive = 0.1;
    expect(stored.highlighted.emissive).toBe(0.9);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.selected.color)).toBe(true);
  });

  it("keeps no-op target updates referentially stable", () => {
    const initial = createInteractionState();
    const selected = setTargetSelected(initial, { kind: "part", partId: 1 }, true);
    expect(setTargetSelected(selected, { kind: "part", partId: 1 }, true)).toBe(selected);
    expect(setTargetSelected(initial, { kind: "part", partId: 1 }, false)).toBe(initial);
    const hovered = setTargetHovered(initial, { kind: "partOccurrence", partOccurrenceId: "1/0" });
    expect(setTargetHovered(hovered, { kind: "partOccurrence", partOccurrenceId: "1/0" })).toBe(
      hovered,
    );
    expect(setTargetHovered(hovered, undefined)).not.toBe(hovered);
    expect(hoveredTarget(setTargetHovered(hovered, undefined))).toBeUndefined();
  });

  it("supports every target kind through the same selection query", () => {
    const targets = [
      { kind: "part", partId: 1 },
      { kind: "partOccurrence", partOccurrenceId: "1/0" },
      { kind: "body", partOccurrenceId: "1/0", bodyId: 2 },
      { kind: "element", partOccurrenceId: "1/0", elementId: 3 },
      { kind: "face", partOccurrenceId: "1/0", elementId: 3, faceIndex: 0 },
      { kind: "node", partOccurrenceId: "1/0", nodeId: 4 },
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

  it("resolves line width only through part and part-occurrence overrides", () => {
    let state = setPartOverride(createInteractionState(), item.partId, { lineWidthPixels: 6 });
    expect(resolveInstanceStyle(item, base, state).lineWidthPixels).toBe(6);
    state = setPartOccurrenceOverride(state, item.partOccurrenceId, { lineWidthPixels: 3 });
    expect(resolveInstanceStyle(item, base, state).lineWidthPixels).toBe(3);
    expect(() =>
      setElementOverride(createInteractionState(), { partOccurrenceId: "1/0", elementId: 2 }, {
        lineWidthPixels: 4,
      } as never),
    ).toThrow("lineWidthPixels is only supported on part and part-occurrence overrides");
  });

  it("rejects non-finite and out-of-range alpha values at override boundaries", () => {
    expect(() =>
      setPartOccurrenceOverride(createInteractionState(), "1/0", { opacity: -0.1 }),
    ).toThrow(/opacity must be finite and in \[0, 1\]/);
    expect(() =>
      setPartOverride(createInteractionState(), 1, {
        color: { r: 0, g: 0, b: 0, a: Number.NaN },
      }),
    ).toThrow(/color\.a must be finite and in \[0, 1\]/);
  });

  it("rejects invalid emissive values through every style boundary", () => {
    const theme = (emissive: number) => ({
      highlighted: { emissive },
      selected: {},
    });
    const setOverrides = [
      (emissive: number) => {
        setPartOverride(createInteractionState(), 1, { emissive });
      },
      (emissive: number) => {
        setPartOccurrenceOverride(createInteractionState(), "1/0", { emissive });
      },
      (emissive: number) => {
        setBodyOverride(
          createInteractionState(),
          { partOccurrenceId: "1/0", bodyId: 3 },
          { emissive },
        );
      },
      (emissive: number) => {
        setElementOverride(
          createInteractionState(),
          { partOccurrenceId: "1/0", elementId: 2 },
          { emissive },
        );
      },
    ] satisfies readonly ((emissive: number) => void)[];
    const invalidValues = [NaN, Infinity, -Infinity, -0.1, 1.1];

    for (const value of invalidValues) {
      expect(() => createInteractionState(theme(value))).toThrow(
        /emissive must be finite and in \[0, 1\]/,
      );
      for (const setOverride of setOverrides) {
        expect(() => {
          setOverride(value);
        }).toThrow(/emissive must be finite and in \[0, 1\]/);
      }
    }
    for (const value of [0, 1]) {
      expect(() => createInteractionState(theme(value))).not.toThrow();
      for (const setOverride of setOverrides) {
        expect(() => {
          setOverride(value);
        }).not.toThrow();
      }
    }
  });

  it("applies selected, hover, and explicit overrides in precedence order", () => {
    expect(
      resolveInstanceStyle(
        item,
        base,
        setTargetSelected(
          createInteractionState(),
          { kind: "partOccurrence", partOccurrenceId: "1/0" },
          true,
        ),
      ),
    ).toMatchObject({ color: { r: 0.95, g: 0.5, b: 0.1, a: 1 }, emissive: 0 });
    const hovered = setTargetHovered(createInteractionState(), {
      kind: "partOccurrence",
      partOccurrenceId: "1/0",
    });
    expect(resolveInstanceStyle(item, base, hovered)).toMatchObject({ emissive: 0.35 });
    expect(resolveInstanceStyle(other, base, filledState())).toBe(base);
    const override = setPartOverride(
      setPartOccurrenceOverride(createInteractionState(), "1/0", { opacity: 0.25 }),
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
  const ref: ElementRef = { partOccurrenceId: "1/0", elementId: 2 };

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

  it("tracks visibility per element occurrence and preserves no-op identityMatrix", () => {
    const initial = createInteractionState();
    const hidden = setElementVisible(initial, ref, false);
    const other = { partOccurrenceId: "2/0", elementId: ref.elementId };
    expect(isElementVisible(initial, ref)).toBe(true);
    expect(isElementVisible(hidden, ref)).toBe(false);
    expect(isElementVisible(hidden, other)).toBe(true);
    expect(setElementVisible(hidden, ref, false)).toBe(hidden);
    expect(setElementVisible(hidden, ref, true)).not.toBe(hidden);
    expect(readInteractionVisibility(hidden).hiddenElementIds.get(ref.partOccurrenceId)).toEqual(
      new Set([2]),
    );
  });

  it("keeps hidden elements in the emphasis stream for GPU updates", () => {
    const hidden = setElementVisible(createInteractionState(), ref, false);
    expect(emphasizedElementRefs(hidden)).toEqual([ref]);
  });
});
