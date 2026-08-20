import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPart,
  createSceneBuilder,
  createViewport,
  identityMatrix,
  type Viewport,
} from "@/entries/root";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";

const COUNTS = [0, 1, 1_000, 100_000] as const;
const CEILINGS_MS = [25, 25, 100, 1_000] as const;
const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;
let viewports: Viewport[] = [];

beforeAll(async () => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
  const scene = createSceneBuilder()
    .addAssembly({ id: 1, placements: [] })
    .setRootAssembly(1)
    .build();
  viewports = await Promise.all(
    COUNTS.map(() =>
      createViewport({ canvas: fakeCanvas(), scene, device: fakeGpuDevice().device }),
    ),
  );
  for (const viewport of viewports) viewport.render();
});

afterAll(() => {
  for (const viewport of viewports) viewport.destroy();
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("new-part admission scaling", () => {
  it("adds one definition and 0, 1, 1k, or 100k first occurrences proportionally", () => {
    const part = createPart(1, {
      geometries: [
        {
          primitive: "points",
          positions: new Float32Array([0, 0, 0]),
          indices: new Uint32Array([0]),
        },
      ],
    });
    const transform = identityMatrix();
    const measurements: number[] = [];
    for (let fixture = 0; fixture < COUNTS.length; fixture += 1) {
      const viewport = viewports[fixture];
      const count = COUNTS[fixture];
      if (viewport === undefined || count === undefined) throw new Error("Fixture is missing");
      const occurrences = viewport.occurrences;
      const started = performance.now();
      viewport.updateScene((update) => {
        update.addPart(part);
        for (let index = 0; index < count; index += 1) {
          update.addPlacement(1, {
            kind: "part",
            placementId: String(index),
            partId: part.id,
            transform,
          });
        }
      });
      viewport.render();
      measurements.push(performance.now() - started);
      expect(viewport.occurrences).toBe(occurrences);
      expect(viewport.occurrences.partOccurrenceCount).toBe(count);
    }
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(
        `Viewport.updateScene new part: ${measurements
          .map((value, index) => `${COUNTS[index]}=${value.toFixed(3)} ms`)
          .join(", ")}`,
      );
    }
    for (let index = 0; index < measurements.length; index += 1) {
      expect(measurements[index]).toBeLessThanOrEqual(CEILINGS_MS[index] ?? 0);
    }
  });
});
