import { describe, expect, it, vi } from "vitest";
import { selectedKeys, harness, element, complete } from "./support";
import type { InteractionTarget } from "./support";

describe("workbench cancellation-errors", () => {
  it("keeps overlapping picks independent and skips stale results", async () => {
    let resolveFirst: ((value: undefined) => void) | undefined;
    let resolveSecond: ((value: undefined) => void) | undefined;
    const first = new Promise<undefined>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<undefined>((resolve) => {
      resolveSecond = resolve;
    });
    const pick = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { workbench } = harness(pick);

    const firstClick = workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);
    const secondClick = workbench.click({ clientX: 110, clientY: 110 } as MouseEvent);
    await vi.waitFor(() => {
      expect(pick).toHaveBeenCalledTimes(2);
    });

    resolveFirst?.(undefined);
    resolveSecond?.(undefined);
    await firstClick;
    await secondClick;
  });

  it("does not let the click synthesized after a box drag invalidate its readback", async () => {
    const target = element("instance-a", 2);
    let resolveRegion: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const result = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveRegion = resolve;
    });
    const { workbench, getInteraction } = harness(
      undefined,
      vi.fn(() => result),
    );
    workbench.pointerDown({ clientX: 10, clientY: 10, pointerType: "mouse" } as PointerEvent);

    const box = workbench.selectBox(complete());
    workbench.pointerCancel();
    await workbench.click({ clientX: 80, clientY: 80 } as MouseEvent);
    resolveRegion?.([target]);
    await box;

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
  });

  it("ignores a rejected region query and a result invalidated by a newer click", async () => {
    const rejected = vi.fn(() => Promise.reject(new Error("region failed")));
    const rejectedHarness = harness(undefined, rejected);
    await expect(rejectedHarness.workbench.selectBox(complete())).resolves.toBeUndefined();
    expect(selectedKeys(rejectedHarness.getInteraction())).toEqual([]);
    expect(rejectedHarness.render).not.toHaveBeenCalled();
    expect(rejectedHarness.selectionFeedback).toHaveBeenCalledWith(
      "Box selection failed: GPU pick readback could not be completed",
    );

    let resolveRegion: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const pendingRegion = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveRegion = resolve;
    });
    const pickRegion = vi.fn(() => pendingRegion);
    const clickPick = vi.fn(() => Promise.resolve(undefined));
    const currentHarness = harness(clickPick, pickRegion);
    const box = currentHarness.workbench.selectBox(complete());
    await vi.waitFor(() => {
      expect(pickRegion).toHaveBeenCalledOnce();
    });
    await currentHarness.workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);
    resolveRegion?.([element("stale", 1)]);
    await box;

    expect(selectedKeys(currentHarness.getInteraction())).toEqual([]);
    expect(currentHarness.selectionFeedback).not.toHaveBeenCalled();
  });

  it("ignores an in-flight pick rejected after destruction", async () => {
    let rejectPick: ((reason?: unknown) => void) | undefined;
    const pick = vi.fn(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectPick = reject;
        }),
    );
    const { workbench } = harness(pick);

    const click = workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);
    await vi.waitFor(() => {
      expect(pick).toHaveBeenCalledOnce();
    });
    workbench.destroy();
    rejectPick?.(new Error("viewport destroyed"));

    await expect(click).resolves.toBeUndefined();
  });
});
