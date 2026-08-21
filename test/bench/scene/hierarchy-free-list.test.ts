import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { identityMatrix } from "@/math/mat4";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { buildScene } from "../../scene-runtime/scene-runtime/support";
import { percentile } from "../measure";

const HISTORICAL_HOLES = 100_000;
const SAMPLES = 7;
const P95_BUDGET_MS = 10;

describe("hierarchy free-list journal budget", () => {
  it("commits one changed slot after a large historical free list without scanning it", () => {
    const result = measureFreeListJournal("commit");
    expect(result.p95Ms).toBeLessThanOrEqual(P95_BUDGET_MS);
    expect(result.accesses).toEqual({ iterations: 0, pops: 1, pushes: 0, splices: 0 });
    report(result);
  });

  it("rolls back one changed slot after a large historical free list without scanning it", () => {
    const result = measureFreeListJournal("rollback");
    expect(result.p95Ms).toBeLessThanOrEqual(P95_BUDGET_MS);
    expect(result.accesses).toEqual({ iterations: 0, pops: 1, pushes: 1, splices: 0 });
    report(result);
  });
});

interface Measurement {
  readonly mode: "commit" | "rollback";
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly accesses: FreeListAccesses;
}

interface FreeListAccesses {
  readonly iterations: number;
  readonly pops: number;
  readonly pushes: number;
  readonly splices: number;
}

function measureFreeListJournal(mode: Measurement["mode"]): Measurement {
  const fixture = historicalInstanceFreeList();
  const before = [...fixture.runtime.instanceFreeSlots];
  const samples: number[] = [];
  let accesses: FreeListAccesses | undefined;
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const tracker = trackFreeList(fixture.runtime.instanceFreeSlots);
    const started = performance.now();
    const transaction = fixture.runtime.beginHierarchyTransaction();
    const slot = addInstance(fixture.runtime);
    if (mode === "commit") transaction.commit();
    else transaction.rollback();
    samples.push(performance.now() - started);
    accesses = tracker.finish();
    expect(fixture.runtime.instanceFreeSlots).toEqual(
      mode === "commit" ? before.slice(0, -1) : before,
    );
    expect(slot).toBe(before.at(-1));
    expect(fixture.runtime.getInstanceSlot("1/added")).toBe(mode === "commit" ? slot : undefined);
    if (mode === "commit") fixture.runtime.removeInstances([slot]);
    expect(fixture.runtime.instanceFreeSlots).toEqual(before);
  }
  if (accesses === undefined) throw new Error("free-list benchmark did not sample");
  return { mode, p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), accesses };
}

function historicalInstanceFreeList() {
  const placements = Array.from({ length: HISTORICAL_HOLES + 1 }, (_, index) => ({
    kind: "part" as const,
    placementId: index === 0 ? "keep" : `historical-${index}`,
    partId: 1,
    transform: identityMatrix(),
  }));
  const runtime = createPackedSceneRuntime(buildScene(1, [{ id: 1, placements }], [1]));
  runtime.removeInstances(Array.from({ length: HISTORICAL_HOLES }, (_, index) => index + 1));
  return { runtime };
}

function addInstance(runtime: ReturnType<typeof createPackedSceneRuntime>): number {
  return (
    runtime.addInstances([
      {
        instanceId: "1/added",
        partId: 1,
        owningNode: 0,
        partVisible: true,
        overrideVisible: true,
        worldTransform: identityMatrix(),
      },
    ])[0] ?? -1
  );
}

function trackFreeList(freeSlots: number[]) {
  let iterations = 0;
  let pops = 0;
  let pushes = 0;
  let splices = 0;
  const originalIterator = freeSlots[Symbol.iterator];
  const originalPop = freeSlots.pop;
  const originalPush = freeSlots.push;
  const originalSplice = freeSlots.splice;
  Object.assign(freeSlots, {
    *[Symbol.iterator]() {
      for (const slot of originalIterator.call(freeSlots)) {
        iterations += 1;
        yield slot;
      }
    },
    pop() {
      pops += 1;
      return originalPop.call(freeSlots);
    },
    push(...slots: number[]) {
      pushes += 1;
      return originalPush.apply(freeSlots, slots);
    },
    splice(start: number, deleteCount?: number, ...slots: number[]) {
      splices += 1;
      return deleteCount === undefined
        ? originalSplice.call(freeSlots, start, freeSlots.length - start)
        : originalSplice.call(freeSlots, start, deleteCount, ...slots);
    },
  });
  return {
    finish: (): FreeListAccesses => {
      Reflect.deleteProperty(freeSlots, Symbol.iterator);
      Reflect.deleteProperty(freeSlots, "pop");
      Reflect.deleteProperty(freeSlots, "push");
      Reflect.deleteProperty(freeSlots, "splice");
      return { iterations, pops, pushes, splices };
    },
  };
}

function report(result: Measurement): void {
  if (process.env["PERF_REPORT"] !== undefined) console.log(JSON.stringify(result));
}
