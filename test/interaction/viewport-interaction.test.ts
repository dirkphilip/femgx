import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PickHit } from "../../src/entries/root";
import {
  hoveredTarget,
  installViewportInteraction,
  isTargetSelected,
  selectedTargets,
  type BoxSelectionEvent,
  type InteractionTarget,
  type ViewportInteractionBoxSelection,
} from "../../src/entries/interaction";
import {
  click,
  hit,
  installFakeWindow,
  pointer,
  restoreFakeWindow,
  settle,
  target,
  type PointerInput,
  viewportHarness,
} from "./viewport-interaction-support";

beforeEach(() => {
  installFakeWindow();
});

afterEach(() => {
  restoreFakeWindow();
});

describe("installViewportInteraction", () => {
  it("maps default hover and click candidates into one immutable interaction state", async () => {
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer({ clientX: 30, clientY: 40 }));
    await settle();
    expect(harness.pick).toHaveBeenCalledWith(20, 20, undefined);
    expect(hoveredTarget(harness.viewport.interaction.state)).toEqual(target);

    harness.canvas.dispatch("pointerdown", pointer());
    harness.canvas.dispatch("click", click());
    await settle();
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([target]);
    expect(harness.setInteraction).toHaveBeenCalledTimes(2);
    disposer();
  });

  it("replaces on plain click and toggles only the clicked target with Control or Meta", async () => {
    const other: InteractionTarget = {
      kind: "face",
      partOccurrenceId: "1/0",
      elementId: 3,
      faceIndex: 0,
    };
    const harness = viewportHarness();
    harness.pick.mockResolvedValueOnce(hit).mockResolvedValueOnce({ ...hit, elementId: 3 });
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("click", click());
    await settle();
    harness.canvas.dispatch("click", click({ ctrlKey: true }));
    await settle();
    expect(isTargetSelected(harness.viewport.interaction.state, target)).toBe(true);
    expect(isTargetSelected(harness.viewport.interaction.state, other)).toBe(true);

    harness.pick.mockResolvedValueOnce(hit);
    harness.canvas.dispatch("click", click({ metaKey: true }));
    await settle();
    expect(isTargetSelected(harness.viewport.interaction.state, target)).toBe(false);
    expect(isTargetSelected(harness.viewport.interaction.state, other)).toBe(true);
    disposer();
  });

  it("accepts modifier-promoted targets returned by the resolver", async () => {
    const harness = viewportHarness();
    harness.pick.mockResolvedValue(hit);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      resolvePoint: ({ modifiers }) =>
        Promise.resolve(
          modifiers.alt
            ? { kind: "partOccurrence" as const, partOccurrenceId: "1/0" }
            : { kind: "element" as const, partOccurrenceId: "1/0", elementId: 2 },
        ),
    });

    harness.canvas.dispatch("click", click({ altKey: true }));
    await settle();
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([
      { kind: "partOccurrence", partOccurrenceId: "1/0" },
    ]);
    harness.canvas.dispatch("click", click({ shiftKey: true }));
    await settle();
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([
      { kind: "element", partOccurrenceId: "1/0", elementId: 2 },
    ]);
    disposer();
  });

  it("resolves a box once, reports its frustum, and applies one bulk transition", async () => {
    const harness = viewportHarness();
    const boxEvents: BoxSelectionEvent[] = [];
    const selections: ViewportInteractionBoxSelection[] = [];
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      onBoxEvent: (event) => boxEvents.push(event),
      onBoxSelection: (selection) => selections.push(selection),
    });

    harness.canvas.dispatch("pointerdown", pointer({ clientX: 30, clientY: 40, buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 80, clientY: 90, buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 80, clientY: 90 }));
    await settle();

    expect(boxEvents.map((event) => event.type)).toEqual(["start", "complete"]);
    expect(harness.pickRegion).toHaveBeenCalledOnce();
    expect(selections).toHaveLength(1);
    const selection = selections[0];
    expect(selection?.granularity).toBe("face");
    expect(selection?.targets).toEqual([target]);
    expect(selection?.frustum.left.normal).toHaveLength(3);
    expect(selection?.frustum.far.normal).toHaveLength(3);
    expect(isTargetSelected(harness.viewport.interaction.state, target)).toBe(true);
    expect(harness.setInteraction).toHaveBeenCalledOnce();
    disposer();
  });

  it("serializes region queries and keeps only the newest queued box", async () => {
    let resolveFirst: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const first = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveFirst = resolve;
    });
    const newest: InteractionTarget = { ...target, elementId: 3 };
    let resolveNewest: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const newestResult = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveNewest = resolve;
    });
    const harness = viewportHarness();
    harness.pickRegion.mockReturnValueOnce(first).mockReturnValueOnce(newestResult);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });
    const completeBox = (anchor: [number, number], current: [number, number]): void => {
      harness.canvas.dispatch(
        "pointerdown",
        pointer({ clientX: anchor[0], clientY: anchor[1], buttons: 1 }),
      );
      harness.canvas.dispatch(
        "pointermove",
        pointer({ clientX: current[0], clientY: current[1], buttons: 1 }),
      );
      harness.canvas.dispatch("pointerup", pointer({ clientX: current[0], clientY: current[1] }));
    };

    completeBox([30, 40], [80, 90]);
    await vi.waitFor(() => {
      expect(harness.pickRegion).toHaveBeenCalledOnce();
    });

    completeBox([40, 50], [90, 95]);
    completeBox([50, 55], [100, 99]);
    await settle();
    expect(harness.pickRegion).toHaveBeenCalledOnce();

    resolveFirst?.([target]);
    await vi.waitFor(() => {
      expect(harness.pickRegion).toHaveBeenCalledTimes(2);
    });
    resolveNewest?.([newest]);
    await settle();

    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([newest]);
    disposer();
  });

  it("applies repeated partial, empty, and Control-append boxes after post-drag pointer motion", async () => {
    const first: InteractionTarget = { ...target, elementId: 2 };
    const second: InteractionTarget = { ...target, elementId: 3 };
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });
    const completeBox = async (
      targets: readonly InteractionTarget[],
      modifiers: Partial<PointerInput> = {},
    ): Promise<void> => {
      let resolveTargets: ((value: readonly InteractionTarget[]) => void) | undefined;
      harness.pickRegion.mockReturnValueOnce(
        new Promise<readonly InteractionTarget[]>((resolve) => {
          resolveTargets = resolve;
        }),
      );
      const queryCount = harness.pickRegion.mock.calls.length;
      harness.canvas.dispatch("pointerdown", pointer({ clientX: 30, clientY: 40, buttons: 1 }));
      harness.canvas.dispatch(
        "pointermove",
        pointer({ clientX: 80, clientY: 90, buttons: 1, ...modifiers }),
      );
      harness.canvas.dispatch("pointerup", pointer({ clientX: 80, clientY: 90, ...modifiers }));
      await vi.waitFor(() => {
        expect(harness.pickRegion).toHaveBeenCalledTimes(queryCount + 1);
      });
      harness.canvas.dispatch("pointermove", pointer({ clientX: 81, clientY: 91 }));
      resolveTargets?.(targets);
      await settle();
    };

    await completeBox([first]);
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([first]);

    await completeBox([]);
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([]);

    await completeBox([second]);
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([second]);

    await completeBox([second, first], { ctrlKey: true });
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([first, second]);
    disposer();
  });

  it("does not swallow a real click when no synthetic click followed a box drag", async () => {
    const clicked: InteractionTarget = { ...target, elementId: 3 };
    const harness = viewportHarness();
    harness.pick.mockResolvedValue({ ...hit, elementId: 3 });
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointerdown", pointer({ clientX: 30, clientY: 40, buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 80, clientY: 90, buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 80, clientY: 90 }));
    await settle();
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([target]);

    harness.canvas.dispatch("pointerdown", pointer({ clientX: 70, clientY: 70, buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 70, clientY: 70 }));
    harness.canvas.dispatch("click", click({ clientX: 70, clientY: 70 }));
    await settle();

    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([clicked]);
    disposer();
  });

  it("swallows the click synthesized after an active box is cancelled", async () => {
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointerdown", pointer({ clientX: 30, clientY: 40, buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 80, clientY: 90, buttons: 1 }));
    harness.canvas.dispatch("pointercancel", pointer({ clientX: 80, clientY: 90 }));
    harness.canvas.dispatch("click", click({ clientX: 80, clientY: 90 }));
    await settle();

    expect(harness.pick).not.toHaveBeenCalled();
    expect(harness.setInteraction).not.toHaveBeenCalled();
    disposer();
  });

  it("reports a current region failure without changing interaction state", async () => {
    const error = new Error("region failed");
    const errors: Array<{ readonly error: unknown; readonly phase: string }> = [];
    const harness = viewportHarness();
    harness.pickRegion.mockRejectedValue(error);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      onError: (failure, phase) => errors.push({ error: failure, phase }),
    });

    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointermove", pointer({ clientX: 90, clientY: 95, buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 90, clientY: 95 }));
    await settle();

    expect(errors).toEqual([{ error, phase: "box" }]);
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([]);
    expect(harness.setInteraction).not.toHaveBeenCalled();
    disposer();
  });

  it("lets hosts replace discovery and suppress the default mutation", async () => {
    const harness = viewportHarness();
    const errors: unknown[] = [];
    const applyInteraction = vi.fn(() => undefined);
    const resolveRegion = vi.fn(({ frustum }: { readonly frustum: unknown }) => {
      expect(frustum).toBeDefined();
      return Promise.resolve([target]);
    });
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      resolveRegion,
      applyInteraction,
      onError: (error) => errors.push(error),
    });

    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 100 }));
    await settle();

    expect(resolveRegion).toHaveBeenCalledOnce();
    expect(applyInteraction).toHaveBeenCalledOnce();
    expect(harness.setInteraction).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    disposer();
  });

  it("does not apply a late point result after disposal", async () => {
    const harness = viewportHarness();
    let resolvePick: (value: PickHit) => void = () => undefined;
    const pendingPick = new Promise<PickHit>((resolve) => {
      resolvePick = resolve;
    });
    harness.pick.mockReturnValue(pendingPick);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch("pointermove", pointer());
    disposer();
    resolvePick(hit);
    await settle();
    expect(harness.setInteraction).not.toHaveBeenCalled();
  });

  it("selects a touch tap once and ignores its synthetic click", async () => {
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    const touch = pointer({ pointerType: "touch" });
    harness.canvas.dispatch("pointerdown", touch);
    harness.canvas.dispatch("pointerup", touch);
    harness.canvas.dispatch("click", click());
    await settle();

    expect(harness.pick).toHaveBeenCalledOnce();
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([target]);
    disposer();
  });

  it("keeps a Highlight-mode touch result current after contact leave", async () => {
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
      touchMode: () => "hover",
    });

    const touch = pointer({ pointerType: "touch" });
    harness.canvas.dispatch("pointerdown", touch);
    harness.canvas.dispatch("pointerup", touch);
    harness.canvas.dispatch("pointerleave", touch);
    await settle();

    expect(hoveredTarget(harness.viewport.interaction.state)).toEqual(target);
    expect(selectedTargets(harness.viewport.interaction.state)).toEqual([]);
    disposer();
  });

  it("does not select after a touch moves beyond the tap threshold", async () => {
    const harness = viewportHarness();
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "face",
    });

    harness.canvas.dispatch(
      "pointerdown",
      pointer({ pointerType: "touch", clientX: 40, clientY: 50 }),
    );
    harness.canvas.dispatch(
      "pointerup",
      pointer({ pointerType: "touch", clientX: 60, clientY: 50 }),
    );
    harness.canvas.dispatch("click", click({ clientX: 60, clientY: 50 }));
    await settle();

    expect(harness.pick).not.toHaveBeenCalled();
    expect(harness.setInteraction).not.toHaveBeenCalled();
    disposer();
  });
});
