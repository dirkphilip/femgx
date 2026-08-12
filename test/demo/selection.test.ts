import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  isTargetSelected,
  setTargetHighlighted,
  setTargetSelected,
  setTargetHovered,
  setPartOverride,
  type InteractionTarget,
} from "../../src/index";
import { selectTarget } from "../../demo/workbench/pick";
import { clearSelection, replaceSelection, toggleSelection } from "../../demo/workbench/selection";
import type { SelectTarget } from "../../demo/workbench/pick";
import type { PickHit } from "../../src/index";

const part: SelectTarget = { kind: "part", partId: 4 };
const instance: SelectTarget = { kind: "instance", instanceId: "1/0" };
const element: SelectTarget = { kind: "element", instanceId: "1/0", elementId: 7 };

describe("demo selection policy", () => {
  it("clears every selected granularity without disturbing hover or styling", () => {
    let state = createInteractionState();
    const targets: readonly InteractionTarget[] = [
      part,
      instance,
      { kind: "body", instanceId: "1/0", bodyId: 2 },
      element,
      { kind: "node", instanceId: "1/0", nodeId: 3 },
      { kind: "face", instanceId: "1/0", elementId: 7, key: "0/1/2" },
    ];
    for (const target of targets) state = setTargetSelected(state, target, true);
    state = setTargetHovered(state, instance);
    state = setTargetHighlighted(state, instance, true);
    state = setPartOverride(state, 4, { emissive: 0.2 });
    const cleared = clearSelection(state);
    for (const target of targets) expect(isTargetSelected(cleared, target)).toBe(false);
    expect(isTargetSelected(cleared, instance)).toBe(false);
  });

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
  });
});
