import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createElementRegionSelection,
  createInteractionState,
  installViewportInteraction,
  selectedElementRegion,
  setElementRegionSelected,
} from "../../src/entries/interaction";
import {
  installFakeWindow,
  pointer,
  restoreFakeWindow,
  settle,
  viewportHarness,
} from "./viewport-interaction-support";

beforeEach(() => {
  installFakeWindow();
});

afterEach(() => {
  restoreFakeWindow();
});

describe("installed element box interaction", () => {
  it("orders stable ids and isolates callbacks from the authoritative default transition", async () => {
    const resolved = createElementRegionSelection(
      new Map([
        ["root/a", new Set([7])],
        ["root/!", new Set([2, 4])],
        ["root/A", new Set([5])],
      ]),
    );
    expect(resolved.partOccurrenceIds).toEqual(["root/!", "root/A", "root/a"]);
    expect(
      selectedElementRegion(setElementRegionSelected(createInteractionState(), resolved, "replace"))
        .partOccurrenceIds,
    ).toEqual(["root/!", "root/A", "root/a"]);
    const harness = viewportHarness();
    harness.pickRegion.mockResolvedValue(resolved);
    const disposer = installViewportInteraction({
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "element",
      onBoxSelection: (box) => {
        if (box.granularity !== "element") throw new Error("Expected packed element callback");
        box.selection.elementIds.fill(99);
        box.selection.offsets.fill(0);
      },
      applyInteraction: (request) => {
        if (request.phase !== "box" || request.granularity !== "element") {
          throw new Error("Expected packed element application");
        }
        expect([...request.selection.elementIds]).toEqual([2, 4, 5, 7]);
        request.selection.elementIds.fill(88);
        request.selection.offsets.fill(0);
        return request.defaultInteraction;
      },
    });

    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 100 }));
    await settle();

    expect([...resolved.elementIds]).toEqual([2, 4, 5, 7]);
    expect([...resolved.offsets]).toEqual([0, 2, 3, 4]);
    expect(selectedElementRegion(harness.viewport.interaction.state)).toMatchObject({
      count: 4,
      partOccurrenceIds: ["root/!", "root/A", "root/a"],
      offsets: new Uint32Array([0, 2, 3, 4]),
      elementIds: new Uint32Array([2, 4, 5, 7]),
    });
    disposer();
  });
});
