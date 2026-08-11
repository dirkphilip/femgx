import { describe, expect, it } from "vitest";
import {
  clearSelection,
  createInteractionState,
  resolveElementStyle,
  setBodySelected,
  setElementOverride,
  setElementHighlighted,
  setElementSelected,
  setFaceSelected,
  setHoveredElement,
  setInstanceSelected,
  setNodeSelected,
  setPartHighlighted,
  setPartSelected,
  setTargetHighlighted,
  setTargetsHighlighted,
  setTargetSelected,
  type InteractionTarget,
  type PickTarget,
} from "../../src/index";
import { identity } from "../../src/math/mat4";
import type { Instance } from "../../src/scene/types";

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
    expect(setTargetHighlighted(cleared, target, false)).toBe(cleared);
  });

  it("applies bulk highlights in input order and tolerates duplicates", () => {
    const first = targets[1];
    const second = targets[3];
    const state = setTargetsHighlighted(createInteractionState(), [second, first, second], true);
    expect(state.highlightedInstanceIds).toEqual(new Set(["1/0"]));
    expect(state.highlightedElementIds.get("1/0")).toEqual(new Set([3]));
    expect(setTargetsHighlighted(state, [first, second], true)).toBe(state);
  });

  it("clears only selection state and preserves every other layer", () => {
    let state = createInteractionState();
    state = setPartSelected(state, 1, true);
    state = setInstanceSelected(state, "1/0", true);
    state = setBodySelected(state, { instanceId: "1/0", bodyId: 2 }, true);
    state = setElementSelected(state, { instanceId: "1/0", elementId: 3 }, true);
    state = setFaceSelected(state, { instanceId: "1/0", elementId: 3, faceKey: "0,1,2" }, true);
    state = setNodeSelected(state, { instanceId: "1/0", nodeId: 4 }, true);
    state = setPartHighlighted(state, 1, true);
    state = setElementHighlighted(state, { instanceId: "1/0", elementId: 5 }, true);
    state = setHoveredElement(state, { instanceId: "1/0", elementId: 5 });
    state = setElementOverride(state, { instanceId: "1/0", elementId: 5 }, { emissive: 0.8 });
    const cleared = clearSelection(state);
    expect(cleared.selectedPartIds.size).toBe(0);
    expect(cleared.selectedInstanceIds.size).toBe(0);
    expect(cleared.selectedBodyIds.size).toBe(0);
    expect(cleared.selectedElementIds.size).toBe(0);
    expect(cleared.selectedFaces.size).toBe(0);
    expect(cleared.selectedNodeIds.size).toBe(0);
    expect(cleared.highlightedPartIds).toEqual(new Set([1]));
    expect(cleared.highlightedElementIds.get("1/0")).toEqual(new Set([5]));
    expect(cleared.hoveredElement).toEqual({ instanceId: "1/0", elementId: 5 });
    expect(cleared.elementOverrides.get("1/0")?.get(5)).toEqual({ emissive: 0.8 });
  });

  it("accepts rich PickTarget values directly", () => {
    const hits: PickTarget[] = [
      { kind: "part", partId: 1 },
      { kind: "instance", instanceId: "1/0" },
      { kind: "element", partId: 1, instanceId: "1/0", elementId: 3 },
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
        hitPosition: [0, 0, 0],
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
    let state = setElementHighlighted(createInteractionState(), ref, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.35,
    });
    state = setElementSelected(state, ref, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.06,
    });
    state = setHoveredElement(state, ref);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.06,
    });
    state = setElementOverride(state, ref, { emissive: 0.8 });
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.8,
    });
  });

  it("prunes the nested collection when the final highlight is cleared", () => {
    const highlighted = setElementHighlighted(createInteractionState(), ref, true);
    const cleared = setElementHighlighted(highlighted, ref, false);
    expect(cleared.highlightedElementIds).toEqual(new Map());
  });
});
