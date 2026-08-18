import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  isTargetSelected,
  setTargetSelected,
  setTargetsSelected,
  type PickHit,
} from "../../src/entries/root";
import type { SceneRuntime } from "../../src/entries/runtime";
import { elementTarget, exactTarget, selectTarget } from "../../demo/workbench/selection/pick";
import {
  replaceSelection,
  replaceTargets,
  appendTargets,
  toggleElementSelection,
  toggleSelection,
  hasVisibleSelection,
  selectedCount,
  selectionDatasetValue,
} from "../../demo/workbench/selection/selection";
import type { SelectTarget } from "../../demo/workbench/selection/pick";
import { parseSelectionGranularity } from "../../demo/workbench/state/workbench-values";

const part: SelectTarget = { kind: "part", partId: 4 };
const instance: SelectTarget = { kind: "partOccurrence", partOccurrenceId: "1/0" };
const element: SelectTarget = { kind: "element", partOccurrenceId: "1/0", elementId: 7 };

describe("demo selection policy", () => {
  it("accepts every selectable toolbar granularity", () => {
    expect(parseSelectionGranularity("part")).toBe("part");
    expect(parseSelectionGranularity("partOccurrence")).toBe("partOccurrence");
    expect(parseSelectionGranularity("body")).toBe("body");
    expect(parseSelectionGranularity("unknown")).toBeUndefined();
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
      partOccurrenceId: "1/0",
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
      kind: "partOccurrence",
      partOccurrenceId: "1/0",
    });

    const directElement: PickHit = {
      kind: "element",
      partId: 4,
      partOccurrenceId: "1/0",
      elementId: 7,
      worldPosition: [0, 0, 0],
    };
    expect(exactTarget(directElement, modifiers)).toMatchObject({
      kind: "element",
      partOccurrenceId: "1/0",
      elementId: 7,
    });
  });

  it("maps authored body picks to occurrence-scoped targets", () => {
    const hit: PickHit = {
      kind: "face",
      partId: 4,
      partOccurrenceId: "1/0",
      elementId: 7,
      bodyId: 2,
      faceIndex: 1,
      key: "face-key",
      nodeIds: [1, 2, 3],
      neighborElementIds: [],
      worldPosition: [0, 0, 0],
      normal: [0, 0, 1],
    };

    expect(selectTarget(hit, "body", modifiersForTest())).toEqual({
      kind: "body",
      partOccurrenceId: "1/0",
      bodyId: 2,
    });
    expect(selectTarget(hit, "body", { ...modifiersForTest(), shiftKey: true })).toMatchObject({
      kind: "body",
    });
  });

  it.each([
    ["part", { kind: "part", partId: 4 }],
    ["partOccurrence", { kind: "partOccurrence", partOccurrenceId: "1/0" }],
    ["element", { kind: "element", partOccurrenceId: "1/0", elementId: 7 }],
    ["face", { kind: "face", partOccurrenceId: "1/0", elementId: 7, faceIndex: 1 }],
    ["node", { kind: "node", partOccurrenceId: "1/0", nodeId: 3 }],
  ] as const)("maps a %s mode to its matching target kind", (granularity, expected) => {
    const hit: PickHit =
      granularity === "node"
        ? {
            kind: "node",
            partId: 4,
            partOccurrenceId: "1/0",
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
            partOccurrenceId: "1/0",
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

  it.each([
    ["part", { kind: "part", partId: 4 }],
    ["partOccurrence", { kind: "partOccurrence", partOccurrenceId: "1/0" }],
  ] as const)("keeps Shift in %s mode at its selected scope", (granularity, expected) => {
    const hit: PickHit = {
      kind: "face",
      partId: 4,
      partOccurrenceId: "1/0",
      elementId: 7,
      faceIndex: 1,
      key: "face-key",
      nodeIds: [1, 2, 3],
      neighborElementIds: [],
      worldPosition: [0, 0, 0],
      normal: [0, 0, 1],
    };
    expect(
      selectTarget(hit, granularity, {
        ...modifiersForTest(),
        shiftKey: true,
      }),
    ).toEqual(expected);
  });

  it("rejects a face or node hit when the selected mode cannot own it", () => {
    const face: PickHit = {
      kind: "face",
      partId: 4,
      partOccurrenceId: "1/0",
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
      partOccurrenceId: "1/0",
      key: "0,1",
      nodeIds: [0, 1],
      incidentElementIds: [7, 8],
      faceRefs: [],
      worldPosition: [0, 0, 0],
      tangent: [1, 0, 0],
    };

    expect(selectTarget(edge, "edge", modifiersForTest())).toEqual({
      kind: "edge",
      partOccurrenceId: "1/0",
      key: "0,1",
    });
    expect(selectTarget(edge, "edge", { ...modifiersForTest(), shiftKey: true })).toEqual({
      kind: "edge",
      partOccurrenceId: "1/0",
      key: "0,1",
    });
  });

  it("maps element-owned targets to one exact element without fabricating instance or part targets", () => {
    const node: SelectTarget = {
      kind: "node",
      partOccurrenceId: "1/0",
      nodeId: 3,
      elementId: 7,
    };
    const face: SelectTarget = {
      kind: "face",
      partOccurrenceId: "1/0",
      elementId: 7,
      faceIndex: 0,
    };
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
      partOccurrenceId: "1/0",
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
      partOccurrenceId: "1/0",
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
      partOccurrenceId: "1/0",
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

  it("applies box replacement and append policies once per target identity", () => {
    const targets = [part, element, element];
    const replaced = replaceTargets(createInteractionState(), targets);
    expect(isTargetSelected(replaced, part)).toBe(true);
    expect(isTargetSelected(replaced, element)).toBe(true);

    const appended = appendTargets(replaced, targets);
    expect(appended).toBe(replaced);
    expect(isTargetSelected(appended, part)).toBe(true);
    expect(isTargetSelected(appended, element)).toBe(true);
    expect(appendTargets(appended, [])).toBe(appended);
  });

  it("bounds dense selection diagnostics without enumerating every identity", () => {
    const targets = Array.from({ length: 257 }, (_, elementId) => ({
      kind: "element" as const,
      partOccurrenceId: "1/0",
      elementId,
    }));
    const interaction = setTargetsSelected(createInteractionState(), targets, true);

    expect(selectedCount(interaction)).toBe(257);
    expect(selectionDatasetValue(interaction)).toBe("count:257");
    expect(selectionDatasetValue(setTargetSelected(createInteractionState(), element, true))).toBe(
      "e:1/0:7",
    );
  });

  it("only advertises framing for selected geometry in visible occurrences", () => {
    const runtime = {
      getPartOccurrences: () => [
        { partId: 4, visible: true },
        { partId: 9, visible: false },
      ],
      isPartOccurrenceVisible: (partOccurrenceId: string) => partOccurrenceId === "visible",
    } as unknown as SceneRuntime;
    const visibleInstance: SelectTarget = { kind: "partOccurrence", partOccurrenceId: "visible" };
    const hiddenInstance: SelectTarget = { kind: "partOccurrence", partOccurrenceId: "hidden" };

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
