import { describe, expect, it } from "vitest";
import { measureMs, measureScaling } from "../measure";
import {
  BENCH_INSTANCE_COUNT,
  BENCH_PART_COUNT,
  BENCH_PLACEMENTS_PER_SUBCASE,
  BENCH_SUBCASE_COUNT,
} from "../fixtures";
import type { BudgetCase, ScalingCase } from "./types";
import { report, reportScaling } from "./types";
import { runtime, sceneBudgets, sceneScalingCases } from "./scene-budgets";
import { geometryBudgets, geometryScalingCases } from "./geometry-budgets";
import { interactionBudgets, interactionScalingCases } from "./interaction-budgets";
import { pickingBudgets, pickingScalingCases } from "./picking-budgets";
import { resultBudgets } from "./result-budgets";

const budgets: readonly BudgetCase[] = [
  ...sceneBudgets,
  ...geometryBudgets,
  ...interactionBudgets,
  ...pickingBudgets,
  ...resultBudgets,
];

const scalingCases: readonly ScalingCase[] = [
  ...sceneScalingCases,
  ...geometryScalingCases,
  ...interactionScalingCases,
  ...pickingScalingCases,
];

describe("performance budgets", () => {
  it.each(budgets)("$name stays under its budget", (budget) => {
    const measured = measureMs(budget.run);
    report(budget.name, budget.description, measured);
    expect(
      measured,
      `${budget.name} (${budget.description}) took ${measured.toFixed(2)} ms, above its ` +
        `${budget.budgetMs} ms budget; see wiki/engineering/benchmarks.md`,
    ).toBeLessThanOrEqual(budget.budgetMs);
  });

  it.each(scalingCases)("$name remains approximately linear", (scaling) => {
    const measurements = measureScaling(scaling.points, {
      warmup: 1,
      samples: 3,
      ...(scaling.iterations === undefined ? {} : { iterations: scaling.iterations }),
    });
    reportScaling(scaling.name, measurements);
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    expect(
      spread,
      `${scaling.name} (${scaling.description}) normalized cost spread was ` +
        `${spread.toFixed(2)}x across ` +
        `${measurements.map(({ size }) => size).join(" → ")}; expected at most ` +
        `${scaling.maxNormalizedSpread}x, see wiki/engineering/benchmarks.md`,
    ).toBeLessThanOrEqual(scaling.maxNormalizedSpread);
  });

  it("toggles visibility on a part with a known instance count", () => {
    const delta = runtime.setPartVisible(1, false);
    expect(delta.changedInstanceIds).toHaveLength(
      (BENCH_PLACEMENTS_PER_SUBCASE / BENCH_PART_COUNT) * BENCH_SUBCASE_COUNT,
    );
    runtime.setPartVisible(1, true);
    expect(runtime.visibleCount).toBe(BENCH_INSTANCE_COUNT);
  });
});
