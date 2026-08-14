import { describe, expect, it } from "vitest";
import {
  clearSelection,
  createInteractionState,
  interactionTargetFromHit,
  isTargetHighlighted,
  isTargetSelected,
  resolveElementStyle,
  setElementOverride,
  setTargetHighlighted,
  setTargetsHighlighted,
  setTargetSelected,
  setTargetHovered,
  setTargetsSelected,
  selectedTargets,
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
  { kind: "block", instanceId: "1/0", blockId: 5 },
  { kind: "element", instanceId: "1/0", elementId: 3 },
  { kind: "face", instanceId: "1/0", elementId: 3, faceIndex: 0 },
  { kind: "node", instanceId: "1/0", nodeId: 4 },
  { kind: "edge", instanceId: "1/0", key: "0,2" },
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

  it("applies duplicate-safe bulk selection across every target kind", () => {
    const duplicateTargets = [...targets, targets[2], targets[4]];
    const state = setTargetsSelected(createInteractionState(), duplicateTargets, true);
    for (const target of targets) expect(isTargetSelected(state, target)).toBe(true);
    expect(setTargetsSelected(state, duplicateTargets, true)).toBe(state);
    const cleared = setTargetsSelected(state, [targets[1], targets[2], targets[2]], false);
    expect(isTargetSelected(cleared, targets[1])).toBe(false);
    expect(isTargetSelected(cleared, targets[2])).toBe(false);
    expect(isTargetSelected(cleared, targets[0])).toBe(true);
  });

  it("clones each affected nested selection collection once and preserves prior state", () => {
    const initial = createInteractionState();
    const selected = setTargetsSelected(initial, [targets[2], targets[2], targets[4]], true);
    const initialData = readInteractionState(initial);
    const selectedData = readInteractionState(selected);
    expect(selectedData.selectedBodyIds).not.toBe(initialData.selectedBodyIds);
    expect(selectedData.selectedElementIds).not.toBe(initialData.selectedElementIds);
    expect(selectedData.selectedBodyIds.get("1/0")).toEqual(new Set([2]));
    expect(selectedData.selectedElementIds.get("1/0")).toEqual(new Set([3]));
    expect(initialData.selectedBodyIds.size).toBe(0);
    expect(initialData.selectedElementIds.size).toBe(0);
    expect(setTargetsSelected(initial, [], true)).toBe(initial);
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
      { kind: "instance", partId: 1, instanceId: "1/0", worldPosition: [0, 0, 0] },
      { kind: "element", partId: 1, instanceId: "1/0", elementId: 3, worldPosition: [0, 0, 0] },
      {
        kind: "face",
        partId: 1,
        instanceId: "1/0",
        elementId: 3,
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
      {
        kind: "edge",
        partId: 1,
        instanceId: "1/0",
        key: "0,2",
        nodeIds: [0, 2],
        incidentElementIds: [3],
        faceRefs: [{ elementId: 3, faceIndex: 0 }],
        worldPosition: [0, 0, 0],
        tangent: [1, 0, 0],
      },
    ];
    for (const hit of hits) {
      expect(setTargetSelected(createInteractionState(), hit, true)).not.toBeUndefined();
    }
  });

  it("keeps authored-edge targets occurrence-scoped and ordered", () => {
    const edge = { kind: "edge", instanceId: "1/0", key: "0,2" } as const;
    const other = { kind: "edge", instanceId: "2/0", key: "0,2" } as const;
    let state = setTargetSelected(createInteractionState(), other, true);
    state = setTargetSelected(state, edge, true);
    expect(isTargetSelected(state, edge)).toBe(true);
    expect(isTargetSelected(state, other)).toBe(true);
    expect(selectedTargets(state)).toEqual([edge, other]);
    expect(
      interactionTargetFromHit(
        {
          kind: "edge",
          partId: 1,
          instanceId: "1/0",
          key: "0,2",
          nodeIds: [0, 2],
          incidentElementIds: [3],
          faceRefs: [{ elementId: 3, faceIndex: 0 }],
          worldPosition: [0, 0, 0],
          tangent: [1, 0, 0],
        },
        "edge",
      ),
    ).toEqual(edge);
    expect(isTargetSelected(clearSelection(state), edge)).toBe(false);
  });
});

describe("element highlight state", () => {
  const base = {
    color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
    emissive: 0,
    opacity: 1,
    lineWidthPixels: 2,
    edge: false,
    nodes: false,
  } as const;
  const instance: Instance = {
    index: 0,
    instanceId: "1/0",
    partId: 1,
    worldTransform: identity(),
  };
  const ref = { instanceId: "1/0", elementId: 3 } as const;

  it("keeps highlight and hover emphasis visible over selection color", () => {
    let state = setTargetHighlighted(createInteractionState(), { kind: "element", ...ref }, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.35,
    });
    state = setTargetSelected(state, { kind: "element", ...ref }, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      color: { r: 0.15, g: 0.8, b: 1, a: 1 },
      emissive: 0.35,
    });
    state = setTargetHovered(state, { kind: "element", ...ref });
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      color: { r: 0.15, g: 0.8, b: 1, a: 1 },
      emissive: 0.2,
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
