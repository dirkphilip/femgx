import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  setBodySelected,
  setElementSelected,
  setHoveredInstance,
  setInstanceHighlighted,
  setInstanceSelected,
  setPartOverride,
  setPartSelected,
  setFaceSelected,
  setNodeSelected,
} from "../../src/index";
import { selectTarget } from "../../demo/pick";
import { clearSelection, replaceSelection, toggleSelection } from "../../demo/workbench/selection";
import type { SelectTarget } from "../../demo/pick";
import type { PickTarget } from "../../src/index";

const part: SelectTarget = { kind: "part", partId: 4 };
const instance: SelectTarget = { kind: "instance", instanceId: "1/0" };
const element: SelectTarget = { kind: "element", instanceId: "1/0", elementId: 7 };

describe("demo selection policy", () => {
  it("clears every selected granularity without disturbing hover or styling", () => {
    let state = createInteractionState();
    state = setPartSelected(state, 4, true);
    state = setInstanceSelected(state, "1/0", true);
    state = setBodySelected(state, { instanceId: "1/0", bodyId: 2 }, true);
    state = setElementSelected(state, { instanceId: "1/0", elementId: 7 }, true);
    state = setNodeSelected(state, { instanceId: "1/0", nodeId: 3 }, true);
    state = setFaceSelected(state, { instanceId: "1/0", elementId: 7, faceKey: "0/1/2" }, true);
    state = setHoveredInstance(state, "1/0");
    state = setInstanceHighlighted(state, "1/0", true);
    state = setPartOverride(state, 4, { emissive: 0.2 });

    const cleared = clearSelection(state);

    expect(cleared.selectedPartIds).toEqual(new Set());
    expect(cleared.selectedInstanceIds).toEqual(new Set());
    expect(cleared.selectedBodyIds).toEqual(new Map());
    expect(cleared.selectedElementIds).toEqual(new Map());
    expect(cleared.selectedNodeIds).toEqual(new Map());
    expect(cleared.selectedFaces).toEqual(new Map());
    expect(cleared.hoveredInstanceId).toBe("1/0");
    expect(cleared.highlightedInstanceIds).toEqual(new Set(["1/0"]));
    expect(cleared.partOverrides.get(4)).toEqual({ emissive: 0.2 });
  });

  it("replaces plain-click selection while modifier toggles support additive selection", () => {
    const first = toggleSelection(createInteractionState(), part);
    const replaced = replaceSelection(first, element);
    expect(replaced.selectedPartIds).toEqual(new Set());
    expect(replaced.selectedElementIds.get("1/0")).toEqual(new Set([7]));

    const same = replaceSelection(replaced, element);
    expect(same.selectedElementIds.get("1/0")).toEqual(new Set([7]));

    const additive = toggleSelection(toggleSelection(createInteractionState(), part), instance);
    expect(additive.selectedPartIds).toEqual(new Set([4]));
    expect(additive.selectedInstanceIds).toEqual(new Set(["1/0"]));
    const toggledOff = toggleSelection(additive, instance);
    expect(toggledOff.selectedPartIds).toEqual(new Set([4]));
    expect(toggledOff.selectedInstanceIds).toEqual(new Set());
  });

  it("keeps Control/Meta as selection modifiers instead of changing pick depth", () => {
    const hit: PickTarget = {
      kind: "node",
      partId: 4,
      instanceId: "1/0",
      elementId: 7,
      nodeId: 3,
      localPosition: [0, 0, 0],
      worldPosition: [0, 0, 0],
      neighborElementIds: [7],
      neighborNodeIds: [1, 2],
    };
    const modifiers = { shiftKey: false, altKey: false, ctrlKey: true, metaKey: false };
    expect(selectTarget(hit, modifiers)).toMatchObject({ kind: "node", nodeId: 3 });
    expect(selectTarget(hit, { ...modifiers, ctrlKey: false, metaKey: true })).toMatchObject({
      kind: "node",
      nodeId: 3,
    });
    expect(selectTarget(hit, { ...modifiers, shiftKey: true })).toMatchObject({
      kind: "element",
      elementId: 7,
    });
  });
});
