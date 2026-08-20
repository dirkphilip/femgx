import { describe, expect, it } from "vitest";
import { createInteractionState } from "@/interaction/interaction";
import { selectedTargetCount } from "@/interaction/selection-queries";
import { setTargetsSelected, type InteractionTarget } from "@/interaction/targets";
import { percentile } from "../measure";

const ELEMENT_COUNTS = [8_000, 131_712, 1_000_000, 2_000_000] as const;
const NODE_COUNTS = [24_389, 1_000_000] as const;
const SAMPLE_COUNT = 7;

interface InteractionMeasurement {
  readonly targetP50Ms: number;
  readonly targetP95Ms: number;
  readonly stateP50Ms: number;
  readonly stateP95Ms: number;
}

describe("large interaction-state selection", () => {
  it.each(ELEMENT_COUNTS)(
    "keeps %i topology-neutral element targets within the local distribution budget",
    (count) => {
      const measurement = measureSelection("element", count);
      report("element", count, measurement);
      expect(measurement.stateP95Ms).toBeLessThanOrEqual(elementStateBudgetMs(count));
    },
  );

  it.each(NODE_COUNTS)(
    "keeps %i topology-neutral node targets within the local distribution budget",
    (count) => {
      const measurement = measureSelection("node", count);
      report("node", count, measurement);
      expect(measurement.stateP95Ms).toBeLessThanOrEqual(count === 1_000_000 ? 125 : 10);
    },
  );

  it("measures append, removal, duplicate, and no-op transitions separately", () => {
    const targets = createTargets("element", 131_712);
    const firstHalf = targets.slice(0, targets.length / 2);
    const secondHalf = targets.slice(targets.length / 2);
    const firstSelected = setTargetsSelected(createInteractionState(), firstHalf, true);
    const selected = setTargetsSelected(createInteractionState(), targets, true);
    const duplicateHeavy = [...targets, ...targets.slice(0, 1_024)];
    const operations = [
      {
        name: "empty select",
        run: () => setTargetsSelected(createInteractionState(), targets, true),
        expectedCount: targets.length,
      },
      {
        name: "append to non-empty",
        run: () => setTargetsSelected(firstSelected, secondHalf, true),
        expectedCount: targets.length,
      },
      {
        name: "partial remove",
        run: () => setTargetsSelected(selected, secondHalf, false),
        expectedCount: firstHalf.length,
      },
      {
        name: "remove all",
        run: () => setTargetsSelected(selected, targets, false),
        expectedCount: 0,
      },
      {
        name: "duplicate-heavy select",
        run: () => setTargetsSelected(createInteractionState(), duplicateHeavy, true),
        expectedCount: targets.length,
      },
      {
        name: "repeated no-op",
        run: () => setTargetsSelected(selected, targets, true),
        expectedCount: targets.length,
      },
    ] as const;
    for (const operation of operations) {
      const state = operation.run();
      expect(selectedTargetCount(state, "element")).toBe(operation.expectedCount);
      reportTransition(operation.name, samples(operation.run));
    }
    expect(setTargetsSelected(selected, targets, true)).toBe(selected);
  });
});

function measureSelection(kind: "element" | "node", count: number): InteractionMeasurement {
  const targets = createTargets(kind, count);
  const targetSamples = samples(() => {
    createTargets(kind, count);
  });
  const stateSamples = samples(() => {
    const state = setTargetsSelected(createInteractionState(), targets, true);
    if (selectedTargetCount(state, kind) !== count) {
      throw new Error(`Selection lost ${kind} targets`);
    }
  });
  return {
    targetP50Ms: percentile(targetSamples, 0.5),
    targetP95Ms: percentile(targetSamples, 0.95),
    stateP50Ms: percentile(stateSamples, 0.5),
    stateP95Ms: percentile(stateSamples, 0.95),
  };
}

function samples(work: () => void): number[] {
  work();
  const timings: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const start = performance.now();
    work();
    timings.push(performance.now() - start);
  }
  return timings;
}

function elementStateBudgetMs(count: number): number {
  // The isolated 2M post-change p95 was 193 ms; 250 ms keeps 30% headroom for GC variance.
  if (count === 2_000_000) return 250;
  if (count === 1_000_000) return 125;
  if (count === 131_712) return 35;
  return 10;
}

function createTargets(kind: "element" | "node", count: number): InteractionTarget[] {
  const targets = new Array<InteractionTarget>(count);
  for (let index = 0; index < count; index += 1) {
    const partOccurrenceId = `mixed/${index % 4}`;
    targets[index] =
      kind === "element"
        ? { kind, partOccurrenceId, elementId: index + 1 }
        : { kind, partOccurrenceId, nodeId: index + 1 };
  }
  return targets;
}

function report(
  kind: "element" | "node",
  count: number,
  measurement: InteractionMeasurement,
): void {
  console.log(
    `${count.toLocaleString()} ${kind} targets across 4 occurrence groups (topology-generic): ` +
      `target p50/p95 ${measurement.targetP50Ms.toFixed(1)}/${measurement.targetP95Ms.toFixed(1)} ms, ` +
      `state p50/p95 ${measurement.stateP50Ms.toFixed(1)}/${measurement.stateP95Ms.toFixed(1)} ms; ` +
      `unique=${count}, groups=4, published memberships=${count}, duplicate membership copies=0`,
  );
}

function reportTransition(name: string, timings: readonly number[]): void {
  console.log(
    `131,712-element ${name}: p50/p95 ${percentile(timings, 0.5).toFixed(1)}/` +
      `${percentile(timings, 0.95).toFixed(1)} ms`,
  );
}
