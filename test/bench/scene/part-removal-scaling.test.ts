import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createViewport, type Viewport } from "@/entries/root";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import { buildTinyManyPieceScene } from "../fixtures";

const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;
let viewport: Viewport | undefined;

beforeAll(async () => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
  viewport = await createViewport({
    canvas: fakeCanvas(),
    scene: buildTinyManyPieceScene("shared-part", 100_000),
    device: fakeGpuDevice().device,
  });
  viewport.render();
});

afterAll(() => {
  viewport?.destroy();
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("whole-part removal scaling", () => {
  it("removes a definition and 100k occurrences without replacing the runtime", () => {
    if (viewport === undefined) throw new Error("Part-removal viewport is missing");
    const occurrences = viewport.occurrences;
    const started = performance.now();

    viewport.updateScene((update) => {
      update.removePart(1, { placements: "remove" });
    });

    const measuredMs = performance.now() - started;
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(`Viewport.updateScene part cascade (100k): ${measuredMs.toFixed(3)} ms`);
    }
    expect(viewport.occurrences).toBe(occurrences);
    expect(viewport.occurrences.partOccurrenceCount).toBe(0);
    expect(measuredMs).toBeLessThanOrEqual(500);
  });
});
