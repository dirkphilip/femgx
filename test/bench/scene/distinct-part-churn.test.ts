import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPart,
  createSceneBuilder,
  createViewport,
  identityMatrix,
  type Part,
  type Viewport,
} from "@/entries/root";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import { percentile } from "../measure";

const PART_COUNT = 100_000;
const HALF_COUNT = PART_COUNT / 2;
const ROOT_ASSEMBLY_ID = 1;
const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;

beforeAll(() => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
});

afterAll(() => {
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("100k distinct-part scene churn", () => {
  it("reports one-part and half-scene add/remove timings", async () => {
    const scene = distinctPartScene(PART_COUNT);
    const removedParts = Array.from({ length: HALF_COUNT }, (_, index) =>
      scene.parts.get(HALF_COUNT + index + 1),
    );
    if (removedParts.some((part) => part === undefined))
      throw new Error("Churn fixture is missing");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: fakeGpuDevice().device,
    });
    viewport.render();
    const addedPart = tinyPart(PART_COUNT + 1);
    try {
      const onePart = measureOnePartChurn(viewport, addedPart);

      const removeHalfMs = measure(() => {
        viewport.updateScene((update) => {
          for (let partId = HALF_COUNT + 1; partId <= PART_COUNT; partId += 1) {
            update.removePart(partId, { placements: "remove" });
          }
        });
      });
      expect(viewport.occurrences.partOccurrenceCount).toBe(HALF_COUNT);
      const addHalfMs = measure(() => {
        viewport.updateScene((update) => {
          for (const part of removedParts) {
            if (part === undefined) throw new Error("Churn fixture part is missing");
            update.addPart(part);
            update.addPlacement(ROOT_ASSEMBLY_ID, placement(part.id));
          }
        });
      });
      expect(viewport.occurrences.partOccurrenceCount).toBe(PART_COUNT);
      console.log(
        JSON.stringify(
          {
            schemaVersion: 1,
            distinctParts: PART_COUNT,
            occurrences: PART_COUNT,
            elementsPerPart: 2,
            addOneMs: onePart.add,
            removeOneMs: onePart.remove,
            removeHalfMs,
            addHalfMs,
          },
          undefined,
          2,
        ),
      );
    } finally {
      viewport.destroy();
    }
  }, 300_000);
});

function measure(operation: () => void): number {
  const started = performance.now();
  operation();
  return performance.now() - started;
}

function measureOnePartChurn(
  viewport: Viewport,
  part: Part,
): { readonly add: Timing; readonly remove: Timing } {
  const add: number[] = [];
  const remove: number[] = [];
  for (let sample = 0; sample < 9; sample += 1) {
    const addMs = measure(() => {
      viewport.updateScene((update) => {
        update.addPart(part);
        update.addPlacement(ROOT_ASSEMBLY_ID, placement(part.id));
      });
    });
    expect(viewport.occurrences.partOccurrenceCount).toBe(PART_COUNT + 1);
    const removeMs = measure(() => {
      viewport.updateScene((update) => {
        update.removePart(part.id, { placements: "remove" });
      });
    });
    expect(viewport.occurrences.partOccurrenceCount).toBe(PART_COUNT);
    if (sample >= 2) {
      add.push(addMs);
      remove.push(removeMs);
    }
  }
  return { add: timing(add), remove: timing(remove) };
}

interface Timing {
  readonly p50: number;
  readonly p95: number;
}

function timing(samples: readonly number[]): Timing {
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

function placement(partId: number) {
  return {
    kind: "part" as const,
    placementId: String(partId - 1),
    partId,
    transform: identityMatrix(),
  };
}

function distinctPartScene(count: number) {
  const builder = createSceneBuilder();
  const placements = new Array<ReturnType<typeof placement>>(count);
  for (let index = 0; index < count; index += 1) {
    const part = tinyPart(index + 1);
    builder.addPart(part);
    placements[index] = placement(part.id);
  }
  return builder
    .addAssembly({ id: ROOT_ASSEMBLY_ID, name: "distinct-part-churn", placements })
    .setRootAssembly(ROOT_ASSEMBLY_ID)
    .build();
}

function tinyPart(id: number) {
  return createPart(id, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
        indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      },
    ],
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
  });
}
