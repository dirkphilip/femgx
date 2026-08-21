import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createElementRegionSelection,
  installViewportInteraction,
  selectedElementRegion,
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
  it("isolates callback columns from discovery and the authoritative default transition", async () => {
    const resolved = createElementRegionSelection(
      new Map([
        ["1/0", new Set([2, 4])],
        ["1/1", new Set([7])],
      ]),
    );
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
        expect([...request.selection.elementIds]).toEqual([2, 4, 7]);
        request.selection.elementIds.fill(88);
        request.selection.offsets.fill(0);
        return request.defaultInteraction;
      },
    });

    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 100 }));
    await settle();

    expect([...resolved.elementIds]).toEqual([2, 4, 7]);
    expect([...resolved.offsets]).toEqual([0, 2, 3]);
    expect(selectedElementRegion(harness.viewport.interaction.state)).toMatchObject({
      count: 3,
      partOccurrenceIds: ["1/0", "1/1"],
      offsets: new Uint32Array([0, 2, 3]),
      elementIds: new Uint32Array([2, 4, 7]),
    });
    disposer();
  });
});
