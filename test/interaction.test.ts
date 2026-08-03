import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  resolveInstanceStyle,
  setHoveredInstance,
  setInstanceOverride,
  setPartHighlighted,
  setPartSelected,
} from "../src/interaction";
import { identity } from "../src/mat4";
import type { ResolvedStyle } from "../src/interaction";
import type { Instance } from "../src/types";

const base: ResolvedStyle = { color: { r: 0.2, g: 0.3, b: 0.4, a: 1 }, emissive: 0, opacity: 1 };
const item: Instance = { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() };

describe("interaction state", () => {
  it("updates immutably and resolves explicit instance style last", () => {
    const initial = createInteractionState();
    const state = setInstanceOverride(
      setPartSelected(setPartHighlighted(initial, 1, true), 1, true),
      "1/0",
      { opacity: 0.5 },
    );
    expect(initial.selectedPartIds.size).toBe(0);
    expect(resolveInstanceStyle(item, base, state)).toMatchObject({ emissive: 0.6, opacity: 0.5 });
    expect(resolveInstanceStyle(item, base, setHoveredInstance(state, "1/0")).emissive).toBe(0.6);
  });

  it("clears hover without leaving an undefined optional property", () => {
    const hovered = setHoveredInstance(createInteractionState(), "1/0");
    const cleared = setHoveredInstance(hovered, undefined);
    expect(cleared).not.toHaveProperty("hoveredInstanceId");
  });
});
