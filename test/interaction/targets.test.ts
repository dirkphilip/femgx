import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  resolveElementStyle,
  resolveInstanceStyle,
  setElementOverride,
} from "../../src/interaction/interaction";
import {
  interactionTargetFromHit,
  isTargetHighlighted,
  isTargetSelected,
  setTargetHighlighted,
  setTargetsHighlighted,
  setTargetSelected,
  setTargetHovered,
  setTargetsSelected,
  type InteractionTarget,
} from "../../src/interaction/targets";
import {
  clearSelection,
  hideSelectedElements,
  selectedElementVisibilitySummary,
  selectedTargetCount,
  selectedTargetSummary,
  selectedTargets,
} from "../../src/interaction/selection-queries";
import { isElementVisible, setElementVisible } from "../../src/interaction/elements";
import type { PickHit } from "../../src/picking/types";
import { identityMatrix } from "../../src/math/mat4";
import type { PartOccurrence } from "../../src/scene/types";
import { readInteractionState } from "../../src/interaction/state";

const targets = [
  { kind: "part", partId: 1 },
  { kind: "partOccurrence", partOccurrenceId: "1/0" },
  { kind: "body", partOccurrenceId: "1/0", bodyId: 2 },
  { kind: "element", partOccurrenceId: "1/0", elementId: 3 },
  { kind: "face", partOccurrenceId: "1/0", elementId: 3, faceIndex: 0 },
  { kind: "node", partOccurrenceId: "1/0", nodeId: 4 },
  { kind: "edge", partOccurrenceId: "1/0", key: "0,2" },
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
    const second = targets[2];
    const state = setTargetsHighlighted(createInteractionState(), [second, first, second], true);
    expect(isTargetHighlighted(state, first)).toBe(true);
    expect(isTargetHighlighted(state, second)).toBe(true);
    expect(setTargetsHighlighted(state, [first, second], true)).toBe(state);
  });

  it("clones each affected nested highlight collection once and preserves prior state", () => {
    const initial = createInteractionState();
    const highlighted = setTargetsHighlighted(initial, [targets[2], targets[2], targets[3]], true);
    const initialData = readInteractionState(initial);
    const highlightedData = readInteractionState(highlighted);
    expect(highlightedData.highlightedBodyIds).not.toBe(initialData.highlightedBodyIds);
    expect(highlightedData.highlightedElementIds).not.toBe(initialData.highlightedElementIds);
    expect(highlightedData.highlightedBodyIds.get("1/0")).toEqual(new Set([2]));
    expect(highlightedData.highlightedElementIds.get("1/0")).toEqual(new Set([3]));
    expect(initialData.highlightedBodyIds.size).toBe(0);
    expect(initialData.highlightedElementIds.size).toBe(0);
    expect(setTargetsHighlighted(initial, [], true)).toBe(initial);
  });

  it("applies duplicate-safe bulk selection across every target kind", () => {
    const duplicateTargets = [...targets, targets[2], targets[3]];
    const state = setTargetsSelected(createInteractionState(), duplicateTargets, true);
    for (const target of targets) expect(isTargetSelected(state, target)).toBe(true);
    expect(selectedTargetSummary(state)).toEqual({
      count: targets.length,
      partIds: new Set([1]),
      partOccurrenceIds: new Set(["1/0"]),
    });
    expect(selectedTargetCount(state, "element")).toBe(1);
    expect(setTargetsSelected(state, duplicateTargets, true)).toBe(state);
    const cleared = setTargetsSelected(state, [targets[1], targets[2], targets[2]], false);
    expect(isTargetSelected(cleared, targets[1])).toBe(false);
    expect(isTargetSelected(cleared, targets[2])).toBe(false);
    expect(isTargetSelected(cleared, targets[0])).toBe(true);
  });

  it("clones each affected nested selection collection once and preserves prior state", () => {
    const initial = createInteractionState();
    const selected = setTargetsSelected(initial, [targets[2], targets[2], targets[3]], true);
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

  it("hides selected elements in one immutable transition and reports visible eligibility", () => {
    const first = { kind: "element" as const, partOccurrenceId: "1/0", elementId: 3 };
    const second = { kind: "element" as const, partOccurrenceId: "1/0", elementId: 4 };
    const selected = setTargetsSelected(createInteractionState(), [first, second], true);
    const partlyHidden = setElementVisible(selected, first, false);

    expect(selectedElementVisibilitySummary(partlyHidden)).toEqual({
      selectedCount: 2,
      visibleCount: 1,
    });

    const hidden = hideSelectedElements(partlyHidden);
    expect(isElementVisible(hidden, first)).toBe(false);
    expect(isElementVisible(hidden, second)).toBe(false);
    expect(isElementVisible(partlyHidden, second)).toBe(true);
    expect(hideSelectedElements(hidden)).toBe(hidden);
  });

  it("clears only selection state and preserves every other layer", () => {
    let state = createInteractionState();
    for (const target of targets) state = setTargetSelected(state, target, true);
    state = setTargetHighlighted(state, { kind: "part", partId: 1 }, true);
    state = setTargetHighlighted(
      state,
      { kind: "element", partOccurrenceId: "1/0", elementId: 5 },
      true,
    );
    state = setTargetHovered(state, { kind: "element", partOccurrenceId: "1/0", elementId: 5 });
    state = setElementOverride(state, { partOccurrenceId: "1/0", elementId: 5 }, { emissive: 0.8 });
    const cleared = clearSelection(state);
    for (const target of targets) expect(isTargetSelected(cleared, target)).toBe(false);
    expect(isTargetHighlighted(cleared, { kind: "part", partId: 1 })).toBe(true);
    expect(
      isTargetHighlighted(cleared, { kind: "element", partOccurrenceId: "1/0", elementId: 5 }),
    ).toBe(true);
    expect(readInteractionState(cleared).hoveredTarget).toEqual({
      kind: "element",
      partOccurrenceId: "1/0",
      elementId: 5,
    });
    expect(readInteractionState(cleared).elementOverrides.get("1/0")?.get(5)).toEqual({
      emissive: 0.8,
    });
  });

  it("accepts rich PickHit values directly", () => {
    const hits: PickHit[] = [
      { kind: "partOccurrence", partId: 1, partOccurrenceId: "1/0", worldPosition: [0, 0, 0] },
      {
        kind: "element",
        partId: 1,
        partOccurrenceId: "1/0",
        elementId: 3,
        worldPosition: [0, 0, 0],
      },
      {
        kind: "face",
        partId: 1,
        partOccurrenceId: "1/0",
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
        partOccurrenceId: "1/0",
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
        partOccurrenceId: "1/0",
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
    const edge = { kind: "edge", partOccurrenceId: "1/0", key: "0,2" } as const;
    const other = { kind: "edge", partOccurrenceId: "2/0", key: "0,2" } as const;
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
          partOccurrenceId: "1/0",
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
  const instance: PartOccurrence = {
    partOccurrenceId: "1/0",
    partId: 1,
    worldTransform: identityMatrix(),
  };
  const ref = { partOccurrenceId: "1/0", elementId: 3 } as const;

  it("keeps highlight and hover emphasis visible over selection color", () => {
    let state = setTargetHighlighted(createInteractionState(), { kind: "element", ...ref }, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.35,
    });
    state = setTargetSelected(state, { kind: "element", ...ref }, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      emissive: 0.35,
    });
    state = setTargetHovered(state, { kind: "element", ...ref });
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      emissive: 0.35,
    });
    state = setElementOverride(state, ref, { emissive: 0.8 });
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      emissive: 0.8,
    });
  });

  it("keeps selection color while applying custom highlight emphasis", () => {
    const theme = {
      highlighted: {
        color: { r: 0.1, g: 0.4, b: 1, a: 1 },
        emissive: 0.4,
        opacity: 0.5,
      },
      selected: {
        color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
        opacity: 0.8,
      },
    } as const;
    let state = createInteractionState(theme);
    state = setTargetHighlighted(state, { kind: "partOccurrence", partOccurrenceId: "1/0" }, true);
    state = setTargetSelected(state, { kind: "partOccurrence", partOccurrenceId: "1/0" }, true);
    expect(resolveInstanceStyle(instance, base, state)).toMatchObject({
      color: theme.selected.color,
      emissive: theme.highlighted.emissive,
      opacity: theme.selected.opacity,
    });

    state = createInteractionState(theme);
    state = setTargetHighlighted(state, { kind: "element", ...ref }, true);
    state = setTargetSelected(state, { kind: "element", ...ref }, true);
    expect(resolveElementStyle(instance, ref.elementId, base, state)).toMatchObject({
      color: theme.selected.color,
      emissive: theme.highlighted.emissive,
      opacity: theme.selected.opacity,
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
