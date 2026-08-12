import { describe, expect, it } from "vitest";
import {
  clearSelection,
  createInteractionState,
  isTargetHighlighted,
  isTargetSelected,
  resolveElementStyle,
  setElementOverride,
  setTargetHighlighted,
  setTargetsHighlighted,
  setTargetSelected,
  setTargetHovered,
  type InteractionTarget,
  type PickHit,
} from "../../src/index";
import { identity } from "../../src/math/mat4";
import type { Instance } from "../../src/scene/types";
import { readInteractionState } from "../../src/interaction/state";

const targets = [
  { kind: "part", partId: 1 },
  { kind: "instance", instanceId: "1/0" },
  { kind: "body", instanceId: "1/0", bodyId: 2 },
  { kind: "element", instanceId: "1/0", elementId: 3 },
  { kind: "face", instanceId: "1/0", elementId: 3, key: "0,1,2" },
  { kind: "node", instanceId: "1/0", nodeId: 4 },
] as const satisfies readonly InteractionTarget[];

describe("InteractionTarget helpers", () => {
  it.each(targets)("dispatches $kind selection immutably", (target) => {
    const initial = createInteractionState();
    const selected = setTargetSelected(initial, target, true);
    expect(selected).not.toBe(initial);
    expect(setTargetSelected(selected, target, true)).toBe(selected);
    const cleared = setTargetSelected(selected, target, false);
    expect(setTargetSelected(cleared, target, false)).toBe(cleared);
  });

  it.each(targets)("dispatches $kind highlight immutably", (target) => {
    const initial = createInteractionState();
    const highlighted = setTargetHighlighted(initial, target, true);
    expect(highlighted).not.toBe(initial);
    expect(setTargetHighlighted(highlighted, target, true)).toBe(highlighted);
    const cleared = setTargetHighlighted(highlighted, target, false);
    expect(isTargetHighlighted(highlighted, target)).toBe(true);
    expect(isTargetHighlighted(cleared, target)).toBe(false);
    expect(setTargetHighlighted(cleared, target, false)).toBe(cleared);
  });

  it("applies bulk highlights in input order and tolerates duplicates", () => {
    const first = targets[1];
    const second = targets[3];
    const state = setTargetsHighlighted(createInteractionState(), [second, first, second], true);
    expect(isTargetHighlighted(state, first)).toBe(true);
    expect(isTargetHighlighted(state, second)).toBe(true);
    expect(setTargetsHighlighted(state, [first, second], true)).toBe(state);
  });

  it("clears only selection state and preserves every other layer", () => {
    let state = createInteractionState();
    for (const target of targets) state = setTargetSelected(state, target, true);
    state = setTargetHighlighted(state, { kind: "part", partId: 1 }, true);
    state = setTargetHighlighted(state, { kind: "element", instanceId: "1/0", elementId: 5 }, true);
    state = setTargetHovered(state, { kind: "element", instanceId: "1/0", elementId: 5 });
    state = setElementOverride(state, { instanceId: "1/0", elementId: 5 }, { emissive: 0.8 });
    const cleared = clearSelection(state);
    for (const target of targets) expect(isTargetSelected(cleared, target)).toBe(false);
    expect(isTargetHighlighted(cleared, { kind: "part", partId: 1 })).toBe(true);
    expect(isTargetHighlighted(cleared, { kind: "element", instanceId: "1/0", elementId: 5 })).toBe(
      true,
    );
    expect(readInteractionState(cleared).hoveredTarget).toEqual({
      kind: "element",
      instanceId: "1/0",
      elementId: 5,
    });
    expect(readInteractionState(cleared).elementOverrides.get("1/0")?.get(5)).toEqual({
      emissive: 0.8,
    });
  });

  it("accepts rich PickHit values directly", () => {
    const hits: PickHit[] = [
      { kind: "part", partId: 1, instanceId: "1/0", worldPosition: [0, 0, 0] },
      { kind: "instance", partId: 1, instanceId: "1/0", worldPosition: [0, 0, 0] },
      { kind: "element", partId: 1, instanceId: "1/0", elementId: 3, worldPosition: [0, 0, 0] },
      {
        kind: "face",
        partId: 1,
        instanceId: "1/0",
        elementId: 3,
        faceId: 0,
        faceIndex: 0,
        key: "0,1,2",
        nodeIds: [0, 1, 2],
        neighborElementIds: [],
        worldPosition: [0, 0, 0],
        normal: [0, 0, 1],
      },
      {
        kind: "node",
        partId: 1,
        instanceId: "1/0",
        elementId: 3,
        nodeId: 4,
        localPosition: [0, 0, 0],
        worldPosition: [0, 0, 0],
        neighborElementIds: [],
        neighborNodeIds: [],
      },
    ];
    for (const hit of hits) {
      expect(setTargetSelected(createInteractionState(), hit, true)).not.toBeUndefined();
    }
  });
});

describe("element highlight state", () => {
  const base = {
    color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
    emissive: 0,
    opacity: 1,
    edge: false,
  } as const;
  const instance: Instance = {
    index: 0,
    instanceId: "1/0",
    partId: 1,
    worldTransform: identity(),
  };
  const ref = { instanceId: "1/0", elementId: 3 } as const;

  it("uses highlighted styling, then selection, hover, and explicit override precedence", () => {
    let state = setTargetHighlighted(createInteractionState(), { kind: "element", ...ref }, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.35,
    });
    state = setTargetSelected(state, { kind: "element", ...ref }, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.06,
    });
    state = setTargetHovered(state, { kind: "element", ...ref });
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.06,
    });
    state = setElementOverride(state, ref, { emissive: 0.8 });
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.8,
    });
  });

  it("prunes the nested collection when the final highlight is cleared", () => {
    const highlighted = setTargetHighlighted(
      createInteractionState(),
      { kind: "element", ...ref },
      true,
    );
    const cleared = setTargetHighlighted(highlighted, { kind: "element", ...ref }, false);
    expect(isTargetHighlighted(cleared, { kind: "element", ...ref })).toBe(false);
  });
});
