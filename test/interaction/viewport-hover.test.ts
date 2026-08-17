import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hoveredTarget, installViewportInteraction, selectedTargets } from "../../src/entries/root";
import {
  click,
  flushAnimationFrame,
  hit,
  installFakeWindow,
  pointer,
  restoreFakeWindow,
  settle,
  target,
  viewportHarness,
} from "./viewport-interaction-support";
import type { PickHit } from "../../src/picking/types";

interface DeferredPick {
  readonly promise: Promise<PickHit>;
  readonly resolve: (value: PickHit) => void;
}

beforeEach(() => {
  installFakeWindow();
});

afterEach(() => {
  restoreFakeWindow();
});

describe("viewport hover scheduling", () => {
  it("coalesces a frame burst into the newest pick", async () => {
    const harness = viewportHarness();
    const dispose = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer({ clientX: 30, clientY: 40 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 50, clientY: 60 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 70, clientY: 80 }));
    expect(harness.pick).not.toHaveBeenCalled();

    flushAnimationFrame();
    expect(harness.pick).toHaveBeenCalledOnce();
    expect(harness.pick).toHaveBeenCalledWith(60, 60, undefined);
    await settle();
    expect(hoveredTarget(harness.viewport.interaction.state)).toEqual(target);
    dispose();
  });

  it("keeps one hover query in flight and queues only the newest event", async () => {
    const first = deferredPick();
    const second = deferredPick();
    const newestHit = { ...hit, elementId: 3, key: "1:3:0" };
    const harness = viewportHarness();
    harness.pick.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const dispose = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer({ clientX: 30, clientY: 40 }));
    flushAnimationFrame();
    expect(harness.pick).toHaveBeenCalledOnce();

    harness.canvas.dispatch("pointermove", pointer({ clientX: 40, clientY: 50 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 70, clientY: 80 }));
    flushAnimationFrame();
    expect(harness.pick).toHaveBeenCalledOnce();

    first.resolve(hit);
    await settle();
    expect(harness.setInteraction).not.toHaveBeenCalled();
    flushAnimationFrame();
    expect(harness.pick).toHaveBeenCalledTimes(2);
    expect(harness.pick).toHaveBeenLastCalledWith(60, 60, undefined);

    second.resolve(newestHit);
    await settle();
    expect(hoveredTarget(harness.viewport.interaction.state)).toEqual({
      ...target,
      elementId: 3,
    });
    dispose();
  });

  it("clears scheduled hover work when the pointer leaves", async () => {
    const harness = viewportHarness();
    const dispose = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer());
    harness.canvas.dispatch("pointerleave", pointer());
    flushAnimationFrame();
    await settle();

    expect(harness.pick).not.toHaveBeenCalled();
    dispose();
  });

  it("clears scheduled hover work when a box gesture starts", async () => {
    const harness = viewportHarness();
    const dispose = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer());
    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 80, clientY: 90, buttons: 1 }));
    flushAnimationFrame();
    await settle();

    expect(harness.pick).not.toHaveBeenCalled();
    dispose();
  });

  it("keeps an active box query current when the pointer leaves", async () => {
    let resolveRegion: ((targets: readonly (typeof target)[]) => void) | undefined;
    const pendingRegion = new Promise<readonly (typeof target)[]>((resolve) => {
      resolveRegion = resolve;
    });
    const harness = viewportHarness();
    harness.pickRegion.mockReturnValueOnce(pendingRegion);
    const dispose = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointerdown", pointer({ clientX: 30, clientY: 40, buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 80, clientY: 90, buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 80, clientY: 90 }));
    harness.canvas.dispatch("pointerleave", pointer({ clientX: 80, clientY: 90 }));
    resolveRegion?.([target]);
    await settle();

    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([target]);
    dispose();
  });

  it("ignores a started hover result after disposal", async () => {
    const pending = deferredPick();
    const harness = viewportHarness();
    harness.pick.mockReturnValue(pending.promise);
    const dispose = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer());
    flushAnimationFrame();
    expect(harness.pick).toHaveBeenCalledOnce();
    dispose();
    pending.resolve(hit);
    await settle();

    expect(harness.setInteraction).not.toHaveBeenCalled();
  });

  it("keeps click and touch tap discovery immediate", async () => {
    const harness = viewportHarness();
    const dispose = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("click", click());
    expect(harness.pick).toHaveBeenCalledOnce();
    const touch = pointer({ pointerType: "touch" });
    harness.canvas.dispatch("pointerdown", touch);
    harness.canvas.dispatch("pointerup", touch);
    expect(harness.pick).toHaveBeenCalledTimes(2);
    await settle();
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([target]);
    dispose();
  });
});

function deferredPick(): DeferredPick {
  let resolve: (value: PickHit) => void = () => undefined;
  const promise = new Promise<PickHit>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
