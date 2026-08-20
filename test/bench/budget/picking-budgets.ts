import { resolvePick } from "@/picking/pick";
import { BENCH_INSTANCE_COUNT } from "../fixtures";
import type { BudgetCase, ScalingCase } from "./types";
import { runtimeInstances } from "./scene-budgets";
import { regionCases, regionResolvers } from "./picking-fixtures";

const PICK_COUNT = 50_000;
const pickIds: number[] = [];
for (let i = 0; i < PICK_COUNT; i++) {
  pickIds.push(i % runtimeInstances.length);
}

export const pickingBudgets: readonly BudgetCase[] = [
  {
    name: "resolvePick",
    description: `${PICK_COUNT} lookups on ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 50,
    run: () => {
      for (const pickId of pickIds) {
        resolvePick(runtimeInstances, pickId);
      }
    },
  },
];

export const pickingScalingCases: readonly ScalingCase[] = [
  {
    name: "pick-region target resolution",
    description: "resolve 16,384–100,000 element identities",
    points: regionCases.map(({ ids }, index) => {
      const resolver = regionResolvers[index];
      if (resolver === undefined) throw new Error("Region scaling resolver is missing");
      return {
        size: ids.length,
        run: () => {
          for (const pickIds of ids) resolver(pickIds);
        },
      };
    }),
    maxNormalizedSpread: 3,
    iterations: 4,
  },
];
