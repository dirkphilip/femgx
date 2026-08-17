import { describe, expect, it, vi } from "vitest";
import {
  setTargetSelected,
  selectedKeys,
  rect,
  harness,
  element,
  complete,
  createInteractionState,
} from "./support";
import type { BoxSelectionResolver, InteractionTarget } from "./support";

describe("workbench through-selection", () => {
  it("replaces selection with distinct visible elements in one render", async () => {
    const first = element("instance-a", 2);
    const second = element("instance-b", 1);
    const initial = setTargetSelected(createInteractionState(), element("old", 9), true);
    const pickRegion = vi.fn(() => Promise.resolve([first, second, first]));
    const { workbench, render, selectionFeedback, getInteraction } = harness(
      undefined,
      pickRegion,
      initial,
    );

    await workbench.selectBox(complete({ shift: true, alt: true }));

    expect(pickRegion).toHaveBeenCalledOnce();
    expect(pickRegion).toHaveBeenCalledWith(rect(), "element");
    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2", "e:instance-b:1"]);
    expect(selectionFeedback).toHaveBeenLastCalledWith("Box selection: 2 FE elements");
    expect(render).toHaveBeenCalledOnce();
  });

  it("allows a custom resolver to replace visible-region discovery", async () => {
    const target = { kind: "face", instanceId: "instance-a", elementId: 2, faceIndex: 1 } as const;
    const pickRegion = vi.fn(() => Promise.resolve([] as readonly InteractionTarget[]));
    const resolver = vi.fn<BoxSelectionResolver>((request) => {
      expect(request.event).toEqual(complete());
      expect(request.granularity).toBe("face");
      return Promise.resolve([target]);
    });
    const { workbench, getInteraction, render } = harness(
      undefined,
      pickRegion,
      createInteractionState(),
      "face",
      { boxSelectionResolver: resolver },
    );

    await workbench.selectBox(complete());

    expect(resolver).toHaveBeenCalledOnce();
    expect(pickRegion).not.toHaveBeenCalled();
    expect(selectedKeys(getInteraction())).toEqual(["f:instance-a:2:1"]);
    expect(render).toHaveBeenCalledOnce();
  });

  it("rejects custom targets that do not match the captured granularity", async () => {
    const resolver = vi.fn<BoxSelectionResolver>(() =>
      Promise.resolve([{ kind: "element", instanceId: "instance-a", elementId: 2 }]),
    );
    const { workbench, getInteraction, render, selectionFeedback } = harness(
      undefined,
      undefined,
      createInteractionState(),
      "face",
      { boxSelectionResolver: resolver },
    );

    await workbench.selectBox(complete());

    expect(selectedKeys(getInteraction())).toEqual([]);
    expect(render).not.toHaveBeenCalled();
    expect(selectionFeedback).toHaveBeenCalledWith(
      "Box selection failed: Box selection resolver returned element target; expected face target",
    );
  });

  it("invalidates an in-flight result when the resolver changes", async () => {
    let resolveOld: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const oldResult = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveOld = resolve;
    });
    const oldResolver = vi.fn<BoxSelectionResolver>(() => oldResult);
    const current = { kind: "element", instanceId: "current", elementId: 3 } as const;
    const newResolver = vi.fn<BoxSelectionResolver>(() => Promise.resolve([current]));
    const { workbench, getInteraction } = harness(
      undefined,
      undefined,
      createInteractionState(),
      "element",
      { boxSelectionResolver: oldResolver },
    );

    const oldBox = workbench.selectBox(complete());
    await vi.waitFor(() => {
      expect(oldResolver).toHaveBeenCalledOnce();
    });
    workbench.setBoxSelectionResolver(newResolver);
    const currentBox = workbench.selectBox(complete());
    resolveOld?.([{ kind: "element", instanceId: "stale", elementId: 1 }]);
    await Promise.all([oldBox, currentBox]);

    expect(newResolver).toHaveBeenCalledOnce();
    expect(selectedKeys(getInteraction())).toEqual(["e:current:3"]);
  });

  it("coalesces region work to one active query and the newest queued drag", async () => {
    let resolveFirst: ((targets: readonly InteractionTarget[]) => void) | undefined;
    let resolveSecond: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const first = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveSecond = resolve;
    });
    const pickRegion = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { workbench, render, getInteraction } = harness(undefined, pickRegion);

    const firstBox = workbench.selectBox(complete());
    await vi.waitFor(() => {
      expect(pickRegion).toHaveBeenCalledOnce();
    });
    const secondBox = workbench.selectBox(complete({ control: true }));
    const thirdBox = workbench.selectBox(complete({ meta: true }));
    expect(pickRegion).toHaveBeenCalledOnce();
    resolveFirst?.([element("stale", 1)]);
    await vi.waitFor(() => {
      expect(pickRegion).toHaveBeenCalledTimes(2);
    });
    resolveSecond?.([element("current", 3)]);
    await Promise.all([firstBox, secondBox, thirdBox]);

    expect(selectedKeys(getInteraction())).toEqual(["e:current:3"]);
    expect(render).toHaveBeenCalledOnce();
  });
});
