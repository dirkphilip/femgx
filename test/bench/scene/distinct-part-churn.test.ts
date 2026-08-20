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
const animationFrameRuntime = globalThis as {
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
};
const originalRequestAnimationFrame = animationFrameRuntime.requestAnimationFrame;
const originalCancelAnimationFrame = animationFrameRuntime.cancelAnimationFrame;
let restoreGpuGlobals: (() => void) | undefined;
let nextFrameHandle = 0;

beforeAll(() => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
  animationFrameRuntime.requestAnimationFrame = () => ++nextFrameHandle;
  animationFrameRuntime.cancelAnimationFrame = () => undefined;
});

afterAll(() => {
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  restoreAnimationFrame("requestAnimationFrame", originalRequestAnimationFrame);
  restoreAnimationFrame("cancelAnimationFrame", originalCancelAnimationFrame);
});

describe("100k distinct-part scene churn", () => {
  it("reports one-part and half-scene add/remove timings", async () => {
    const scene = distinctPartScene(PART_COUNT);
    const removedParts: Part[] = [];
    for (let partId = HALF_COUNT + 1; partId <= PART_COUNT; partId += 1) {
      const part = scene.parts.get(partId);
      if (part === undefined) throw new Error(`Churn fixture part ${partId} is missing`);
      removedParts.push(part);
    }
    const removedPlacements = removedParts.map(({ id }) => placement(id));
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: fakeGpuDevice().device,
    });
    viewport.render();
    const addedPart = tinyPart(PART_COUNT + 1);
    const addedPlacement = placement(addedPart.id);
    try {
      const onePart = measureOnePartChurn(viewport, addedPart, addedPlacement);

      const half = measureHalfChurn(viewport, removedParts, removedPlacements);
      console.log(
        JSON.stringify(
          {
            schemaVersion: 2,
            distinctParts: PART_COUNT,
            occurrences: PART_COUNT,
            elementsPerPart: 2,
            addOne: onePart.add,
            removeOne: onePart.remove,
            removeHalf: half.remove,
            addHalf: half.add,
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

function measureUpdateAndRender(viewport: Viewport, update: () => void): OperationTiming {
  const updateMs = measure(update);
  const renderMs = measure(() => {
    viewport.render();
  });
  return { updateMs, renderMs, totalMs: updateMs + renderMs };
}

function measureOnePartChurn(
  viewport: Viewport,
  part: Part,
  partPlacement: ReturnType<typeof placement>,
): { readonly add: RepeatedOperationTiming; readonly remove: RepeatedOperationTiming } {
  const addUpdates: number[] = [];
  const addRenders: number[] = [];
  const addTotals: number[] = [];
  const removeUpdates: number[] = [];
  const removeRenders: number[] = [];
  const removeTotals: number[] = [];
  for (let sample = 0; sample < 9; sample += 1) {
    const add = measureUpdateAndRender(viewport, () => {
      viewport.updateScene((update) => {
        update.addPart(part);
        update.addPlacement(ROOT_ASSEMBLY_ID, partPlacement);
      });
    });
    expect(viewport.occurrences.partOccurrenceCount).toBe(PART_COUNT + 1);
    const remove = measureUpdateAndRender(viewport, () => {
      viewport.updateScene((update) => {
        update.removePart(part.id, { placements: "remove" });
      });
    });
    expect(viewport.occurrences.partOccurrenceCount).toBe(PART_COUNT);
    if (sample >= 2) {
      addUpdates.push(add.updateMs);
      addRenders.push(add.renderMs);
      addTotals.push(add.totalMs);
      removeUpdates.push(remove.updateMs);
      removeRenders.push(remove.renderMs);
      removeTotals.push(remove.totalMs);
    }
  }
  return {
    add: {
      updateMs: timing(addUpdates),
      renderMs: timing(addRenders),
      totalMs: timing(addTotals),
    },
    remove: {
      updateMs: timing(removeUpdates),
      renderMs: timing(removeRenders),
      totalMs: timing(removeTotals),
    },
  };
}

function measureHalfChurn(
  viewport: Viewport,
  parts: readonly Part[],
  placements: readonly ReturnType<typeof placement>[],
): { readonly add: RepeatedOperationTiming; readonly remove: RepeatedOperationTiming } {
  const addUpdates: number[] = [];
  const addRenders: number[] = [];
  const addTotals: number[] = [];
  const removeUpdates: number[] = [];
  const removeRenders: number[] = [];
  const removeTotals: number[] = [];
  for (let sample = 0; sample < 4; sample += 1) {
    const remove = measureUpdateAndRender(viewport, () => {
      removeParts(viewport);
    });
    expect(viewport.occurrences.partOccurrenceCount).toBe(HALF_COUNT);
    const add = measureUpdateAndRender(viewport, () => {
      addParts(viewport, parts, placements);
    });
    expect(viewport.occurrences.partOccurrenceCount).toBe(PART_COUNT);
    if (sample === 0) continue;
    addUpdates.push(add.updateMs);
    addRenders.push(add.renderMs);
    addTotals.push(add.totalMs);
    removeUpdates.push(remove.updateMs);
    removeRenders.push(remove.renderMs);
    removeTotals.push(remove.totalMs);
  }
  return {
    add: {
      updateMs: timing(addUpdates),
      renderMs: timing(addRenders),
      totalMs: timing(addTotals),
    },
    remove: {
      updateMs: timing(removeUpdates),
      renderMs: timing(removeRenders),
      totalMs: timing(removeTotals),
    },
  };
}

function removeParts(viewport: Viewport): void {
  viewport.updateScene((update) => {
    for (let partId = HALF_COUNT + 1; partId <= PART_COUNT; partId += 1) {
      update.removePart(partId, { placements: "remove" });
    }
  });
}

function addParts(
  viewport: Viewport,
  parts: readonly Part[],
  placements: readonly ReturnType<typeof placement>[],
): void {
  viewport.updateScene((update) => {
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const partPlacement = placements[index];
      if (part === undefined || partPlacement === undefined)
        throw new Error(`Churn fixture row ${index} is missing`);
      update.addPart(part);
      update.addPlacement(ROOT_ASSEMBLY_ID, partPlacement);
    }
  });
}

interface OperationTiming {
  readonly updateMs: number;
  readonly renderMs: number;
  readonly totalMs: number;
}

interface RepeatedOperationTiming {
  readonly updateMs: Timing;
  readonly renderMs: Timing;
  readonly totalMs: Timing;
}

interface Timing {
  readonly p50: number;
  readonly p95: number;
}

function timing(samples: readonly number[]): Timing {
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

function restoreAnimationFrame(
  name: "requestAnimationFrame" | "cancelAnimationFrame",
  value: typeof requestAnimationFrame | typeof cancelAnimationFrame | undefined,
): void {
  if (value !== undefined) {
    Object.defineProperty(animationFrameRuntime, name, { configurable: true, value });
  } else if (name === "requestAnimationFrame") {
    delete animationFrameRuntime.requestAnimationFrame;
  } else {
    delete animationFrameRuntime.cancelAnimationFrame;
  }
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
