import { describe, expect, it } from "vitest";
import {
  createElementRegionSelection,
  createInteractionState,
  selectedElementRegion,
  setElementRegionSelected,
  setTargetSelected,
} from "../../src/entries/interaction";
import { readInteractionState } from "../../src/interaction/state";

describe("packed element region selections", () => {
  it("sorts and deduplicates stable occurrence groups into one pair of typed columns", () => {
    const selection = createElementRegionSelection(
      new Map([
        ["root/b", [9, 2, 2]],
        ["root/a", [7, 1]],
        ["empty", []],
      ]),
    );

    expect(selection).toMatchObject({
      kind: "element",
      count: 4,
      partOccurrenceIds: ["root/a", "root/b"],
    });
    expect([...selection.offsets]).toEqual([0, 2, 4]);
    expect([...selection.elementIds]).toEqual([1, 7, 2, 9]);
  });

  it("applies replace and add directly while cloning each touched ownership collection once", () => {
    const first = createElementRegionSelection(
      new Map([
        ["root/a", [1, 2]],
        ["root/b", [8]],
      ]),
    );
    const initial = setTargetSelected(
      createInteractionState(),
      { kind: "node", partOccurrenceId: "root/a", nodeId: 3 },
      true,
    );
    const replaced = setElementRegionSelected(initial, first, "replace");
    const firstData = readInteractionState(replaced);
    expect(firstData.selectedNodeIds.size).toBe(0);
    expect(firstData.selectedElementIds.get("root/a")).toEqual(new Set([1, 2]));
    expect(firstData.selectedElementIds.get("root/b")).toEqual(new Set([8]));

    const second = createElementRegionSelection(
      new Map([
        ["root/a", [2, 4]],
        ["root/c", [6]],
      ]),
    );
    const added = setElementRegionSelected(replaced, second, "add");
    const secondData = readInteractionState(added);
    expect(secondData.selectedElementIds).not.toBe(firstData.selectedElementIds);
    expect(secondData.selectedElementIds.get("root/a")).toEqual(new Set([1, 2, 4]));
    expect(secondData.selectedElementIds.get("root/b")).toBe(
      firstData.selectedElementIds.get("root/b"),
    );
    expect(secondData.selectedElementIds.get("root/c")).toEqual(new Set([6]));
    expect(setElementRegionSelected(added, second, "add")).toBe(added);
  });

  it("returns caller-owned snapshot columns without exposing immutable state membership", () => {
    const selected = setElementRegionSelected(
      createInteractionState(),
      createElementRegionSelection(new Map([["root/a", [1, 4]]])),
      "add",
    );
    const first = selectedElementRegion(selected);
    first.elementIds[0] = 99;
    const second = selectedElementRegion(selected);

    expect([...second.elementIds]).toEqual([1, 4]);
    expect(second).not.toBe(first);
  });

  it("rejects malformed external CSR columns before partially changing state", () => {
    const malformed = {
      kind: "element" as const,
      count: 2,
      partOccurrenceIds: ["root/a"],
      offsets: new Uint32Array([0, 2]),
      elementIds: new Uint32Array([4, 4]),
    };
    const initial = createInteractionState();

    expect(() => setElementRegionSelected(initial, malformed, "add")).toThrow(/duplicate-free/);
    expect(selectedElementRegion(initial).count).toBe(0);
  });
});
