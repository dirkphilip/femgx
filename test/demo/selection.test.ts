import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  isTargetSelected,
  setTargetSelected,
  type PickHit,
} from "../../src/entries/root";
import type { SceneRuntime } from "../../src/entries/runtime";
import {
  elementBlockTarget,
  elementTarget,
  exactTarget,
  selectTarget,
} from "../../demo/workbench/selection/pick";
import {
  replaceSelection,
  replaceTargets,
  toggleTargets,
  toggleElementSelection,
  toggleSelection,
  hasVisibleSelection,
} from "../../demo/workbench/selection/selection";
import type { SelectTarget } from "../../demo/workbench/selection/pick";

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
    expect(exactTarget(hit, modifiers)).toMatchObject({ kind: "node", nodeId: 3 });
    expect(exactTarget(hit, { ...modifiers, ctrlKey: false, metaKey: true })).toMatchObject({
      kind: "node",
      nodeId: 3,
    });
    expect(exactTarget(hit, { ...modifiers, shiftKey: true })).toMatchObject({
      kind: "element",
      elementId: 7,
    });
    expect(exactTarget(hit, { ...modifiers, shiftKey: true, altKey: true })).toMatchObject({
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
    expect(exactTarget(directElement, modifiers)).toMatchObject({
      kind: "element",
      instanceId: "1/0",
      elementId: 7,
    });
  });

  it("retains authored block ownership for exact context targets", () => {
    const hit: PickHit = {
      kind: "node",
      partId: 4,
      instanceId: "1/0",
      elementId: 7,
      blockId: 2,
      nodeId: 3,
      localPosition: [0, 0, 0],
      worldPosition: [0, 0, 0],
      neighborElementIds: [7],
      neighborNodeIds: [1, 2],
    };
    const target = exactTarget(hit, modifiersForTest());
    expect(target).toMatchObject({ kind: "node", blockId: 2 });
    expect(target === undefined ? undefined : elementBlockTarget(target)).toEqual({
      kind: "block",
      instanceId: "1/0",
      blockId: 2,
    });
    expect(selectTarget(hit, "element", modifiersForTest())).toEqual({
      kind: "element",
      instanceId: "1/0",
      elementId: 7,
      blockId: 2,
    });
  });

  it.each([
    ["element", { kind: "element", instanceId: "1/0", elementId: 7 }],
    ["face", { kind: "face", instanceId: "1/0", elementId: 7, faceIndex: 1 }],
    ["node", { kind: "node", instanceId: "1/0", nodeId: 3 }],
  ] as const)("maps a %s mode to its matching target kind", (granularity, expected) => {
    const hit: PickHit =
      granularity === "node"
        ? {
            kind: "node",
            partId: 4,
            instanceId: "1/0",
            elementId: 7,
            nodeId: 3,
            localPosition: [0, 0, 0],
            worldPosition: [0, 0, 0],
            neighborElementIds: [7],
            neighborNodeIds: [1, 2],
          }
        : {
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
    expect(selectTarget(hit, granularity, modifiersForTest())).toMatchObject(expected);
  });

  it("rejects a face or node hit when the selected mode cannot own it", () => {
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
    expect(selectTarget(face, "node", modifiersForTest())).toBeUndefined();
  });

  it("keeps authored edges occurrence-scoped when Shift cannot choose one owner", () => {
    const edge: PickHit = {
      kind: "edge",
      partId: 4,
      instanceId: "1/0",
      key: "0,1",
      nodeIds: [0, 1],
      incidentElementIds: [7, 8],
      faceRefs: [],
      worldPosition: [0, 0, 0],
      tangent: [1, 0, 0],
    };

    expect(selectTarget(edge, "edge", modifiersForTest())).toEqual({
      kind: "edge",
      instanceId: "1/0",
      key: "0,1",
    });
    expect(selectTarget(edge, "edge", { ...modifiersForTest(), shiftKey: true })).toEqual({
      kind: "edge",
      instanceId: "1/0",
      key: "0,1",
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

    expect(selectTarget(node, "element", modifiersForTest())).toEqual(element);
    expect(selectTarget(face, "element", modifiersForTest())).toEqual(element);
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

  it("applies box replacement and toggle policies once per target identity", () => {
    const targets = [part, element, element];
    const replaced = replaceTargets(createInteractionState(), targets);
    expect(isTargetSelected(replaced, part)).toBe(true);
    expect(isTargetSelected(replaced, element)).toBe(true);

    const toggled = toggleTargets(replaced, targets);
    expect(isTargetSelected(toggled, part)).toBe(false);
    expect(isTargetSelected(toggled, element)).toBe(false);
    expect(toggleTargets(toggled, [])).toBe(toggled);
  });

  it("only advertises framing for selected geometry in visible occurrences", () => {
    const runtime = {
      getInstances: () => [
        { partId: 4, visible: true },
        { partId: 9, visible: false },
      ],
      isInstanceVisible: (instanceId: string) => instanceId === "visible",
    } as unknown as SceneRuntime;
    const visibleInstance: SelectTarget = { kind: "instance", instanceId: "visible" };
    const hiddenInstance: SelectTarget = { kind: "instance", instanceId: "hidden" };

    expect(hasVisibleSelection(createInteractionState(), runtime)).toBe(false);
    expect(hasVisibleSelection(toggleSelection(createInteractionState(), part), runtime)).toBe(
      true,
    );
    expect(
      hasVisibleSelection(toggleSelection(createInteractionState(), visibleInstance), runtime),
    ).toBe(true);
    expect(
      hasVisibleSelection(toggleSelection(createInteractionState(), hiddenInstance), runtime),
    ).toBe(false);
    expect(
      hasVisibleSelection(
        toggleSelection(createInteractionState(), { kind: "part", partId: 9 }),
        runtime,
      ),
    ).toBe(false);
  });
});

function modifiersForTest(): {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
} {
  return { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
}
