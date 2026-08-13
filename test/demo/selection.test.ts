import { describe, expect, it } from "vitest";
import { createInteractionState, isTargetSelected, setTargetSelected } from "../../src/index";
import { elementSelectTarget, elementTarget, selectTarget } from "../../demo/workbench/pick";
import {
  replaceSelection,
  toggleElementSelection,
  toggleSelection,
} from "../../demo/workbench/selection";
import type { SelectTarget } from "../../demo/workbench/pick";
import type { PickHit } from "../../src/index";

const part: SelectTarget = { kind: "part", partId: 4 };
const instance: SelectTarget = { kind: "instance", instanceId: "1/0" };
const element: SelectTarget = { kind: "element", instanceId: "1/0", elementId: 7 };

describe("demo selection policy", () => {
  it("replaces plain-click selection while modifier toggles support additive selection", () => {
    const first = toggleSelection(createInteractionState(), part);
    const replaced = replaceSelection(first, element);
    expect(isTargetSelected(replaced, part)).toBe(false);
    expect(isTargetSelected(replaced, element)).toBe(true);
    const same = replaceSelection(replaced, element);
    expect(isTargetSelected(same, element)).toBe(false);
    const additive = toggleSelection(toggleSelection(createInteractionState(), part), instance);
    expect(isTargetSelected(additive, part)).toBe(true);
    expect(isTargetSelected(additive, instance)).toBe(true);
    expect(isTargetSelected(toggleSelection(additive, instance), instance)).toBe(false);
  });

  it("keeps Control/Meta as selection modifiers instead of changing pick depth", () => {
    const hit: PickHit = {
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
    expect(selectTarget(hit, { ...modifiers, shiftKey: true, altKey: true })).toMatchObject({
      kind: "instance",
      instanceId: "1/0",
    });

    const directElement: PickHit = {
      kind: "element",
      partId: 4,
      instanceId: "1/0",
      elementId: 7,
      worldPosition: [0, 0, 0],
    };
    expect(selectTarget(directElement, modifiers)).toMatchObject({
      kind: "element",
      instanceId: "1/0",
      elementId: 7,
    });
  });

  it("maps element-owned targets to one exact element without fabricating instance or part targets", () => {
    const node: SelectTarget = {
      kind: "node",
      instanceId: "1/0",
      nodeId: 3,
      elementId: 7,
    };
    const face: SelectTarget = { kind: "face", instanceId: "1/0", elementId: 7, faceIndex: 0 };
    expect(elementTarget(node)).toEqual(element);
    expect(elementTarget(face)).toEqual(element);
    expect(elementTarget(element)).toEqual(element);
    expect(elementTarget(instance)).toBeUndefined();
    expect(elementTarget(part)).toBeUndefined();
  });

  it("normalizes node and face picks to elements without modifier promotion", () => {
    const node: PickHit = {
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
    const face: PickHit = {
      kind: "face",
      partId: 4,
      instanceId: "1/0",
      elementId: 7,
      faceIndex: 1,
      key: "face-key",
      nodeIds: [1, 2, 3],
      neighborElementIds: [],
      worldPosition: [0, 0, 0],
      normal: [0, 0, 1],
    };

    expect(elementSelectTarget(node)).toEqual(element);
    expect(elementSelectTarget(face)).toEqual(element);
  });

  it("replaces selection when selecting an element and removes only it when deselecting", () => {
    const node: SelectTarget = {
      kind: "node",
      instanceId: "1/0",
      nodeId: 3,
      elementId: 7,
    };
    const other: SelectTarget = { kind: "part", partId: 9 };
    let state = setTargetSelected(createInteractionState(), other, true);
    state = toggleElementSelection(state, node);
    expect(isTargetSelected(state, other)).toBe(false);
    expect(isTargetSelected(state, element)).toBe(true);
    state = setTargetSelected(state, other, true);
    state = toggleElementSelection(state, node);
    expect(isTargetSelected(state, element)).toBe(false);
    expect(isTargetSelected(state, other)).toBe(true);
  });
});
