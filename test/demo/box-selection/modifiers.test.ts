import { describe, expect, it, vi } from "vitest";
import {
  isTargetSelected,
  setTargetSelected,
  selectedKeys,
  rect,
  harness,
  element,
  complete,
  createInteractionState,
} from "./support";
import type { InteractionTarget } from "./support";

describe("workbench modifiers", () => {
  it.each([
    ["part", { kind: "part", partId: 1 }, "p:1"],
    ["partOccurrence", { kind: "partOccurrence", partOccurrenceId: "instance-a" }, "i:instance-a"],
    [
      "face",
      { kind: "face", partOccurrenceId: "instance-a", elementId: 2, faceIndex: 1 },
      "f:instance-a:2:1",
    ],
    ["node", { kind: "node", partOccurrenceId: "instance-a", nodeId: 3 }, "n:instance-a:3"],
  ] as const)("box selection uses %s targets", async (granularity, target, expectedKey) => {
    const pickRegion = vi.fn(() => Promise.resolve([target, target] as const));
    const { workbench, render, selectionFeedback, getInteraction } = harness(
      undefined,
      pickRegion,
      createInteractionState(),
      granularity,
    );

    await workbench.selectBox(complete());

    expect(pickRegion).toHaveBeenCalledWith(rect(), granularity);
    expect(selectedKeys(getInteraction())).toEqual([expectedKey]);
    expect(selectionFeedback).toHaveBeenLastCalledWith(`Box selection: 1 ${granularity}`);
    expect(render).toHaveBeenCalledOnce();
  });

  it("appends distinct visible elements for Control or Meta without changing other selection", async () => {
    const first = element("instance-a", 2);
    const second = element("instance-b", 1);
    const initial = setTargetSelected(createInteractionState(), first, true);
    const pickRegion = vi.fn(() => Promise.resolve([first, second, second]));
    const { workbench, render, getInteraction } = harness(undefined, pickRegion, initial);

    await workbench.selectBox(complete({ control: true }));

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2", "e:instance-b:1"]);
    expect(isTargetSelected(getInteraction(), first)).toBe(true);
    expect(render).toHaveBeenCalledOnce();
  });

  it("clears on an empty plain box and leaves Control or Meta empty boxes alone", async () => {
    const selected = element("instance-a", 2);
    const initial = setTargetSelected(createInteractionState(), selected, true);
    const pickRegion = vi.fn(() => Promise.resolve([] as readonly InteractionTarget[]));
    const { workbench, render, getInteraction } = harness(undefined, pickRegion, initial);

    await workbench.selectBox(complete());
    expect(selectedKeys(getInteraction())).toEqual([]);
    expect(render).toHaveBeenCalledOnce();

    render.mockClear();
    const preserved = getInteraction();
    await workbench.selectBox(complete({ meta: true }));
    expect(getInteraction()).toBe(preserved);
    expect(render).not.toHaveBeenCalled();
  });
});
