import { describe, expect, it } from "vitest";
import { batchInstancesByPart } from "../../src/runtime/batch";
import { flattenAssembly } from "../../src/runtime/flatten";
import { createElement, type Element } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import {
  HEX8_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET4_SHAPE,
} from "../../src/elements/shapes";
import { heterogeneousElementParts } from "../../src/geometry/heterogeneous-element-mesh";
import { translation } from "../../src/math/mat4";
import { resolvePick } from "../../src/picking/pick";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";
import {
  BENCH_HIERARCHY_DEPTH,
  BENCH_HIERARCHY_FANOUT,
  BENCH_HIERARCHY_INSTANCE_COUNT,
  BENCH_HIERARCHY_PARTS_PER_LEAF,
  BENCH_INSTANCE_COUNT,
  BENCH_PART_COUNT,
  BENCH_PLACEMENTS_PER_SUBCASE,
  BENCH_SUBCASE_COUNT,
  makeHierarchyScene,
  makeScene,
} from "./fixtures";
import { measureMs } from "./measure";

const shallowScene = makeScene({
  subcaseCount: BENCH_SUBCASE_COUNT,
  placementsPerSubcase: BENCH_PLACEMENTS_PER_SUBCASE,
  partCount: BENCH_PART_COUNT,
});

const deepScene = makeHierarchyScene({
  depth: BENCH_HIERARCHY_DEPTH,
  fanout: BENCH_HIERARCHY_FANOUT,
  partsPerLeaf: BENCH_HIERARCHY_PARTS_PER_LEAF,
  partCount: BENCH_PART_COUNT,
});

const flattened = flattenAssembly({
  assemblyId: shallowScene.rootAssemblyId,
  assemblies: shallowScene.assemblies,
  visibleAssemblyIds: shallowScene.visibleAssemblyIds,
  visiblePartIds: shallowScene.visiblePartIds,
});

const runtime = createSceneRuntime(shallowScene);

const heterogeneousModel = makeHeterogeneousModel(100);

const PICK_COUNT = 50_000;
const pickIds: number[] = [];
for (let i = 0; i < PICK_COUNT; i++) {
  pickIds.push(i % flattened.length);
}

function makeHeterogeneousModel(repetitions: number) {
  const nodes: number[] = [];
  const elements: Element[] = [];
  let nextElementId = 1;
  const addElement = (shape: Parameters<typeof createElement>[1], nodeCount: number): void => {
    const start = nodes.length / 3;
    for (let node = 0; node < nodeCount; node += 1) {
      nodes.push(start + node, 0, node % 2);
    }
    elements.push(
      createElement(
        nextElementId,
        shape,
        Array.from({ length: nodeCount }, (_, node) => start + node),
      ),
    );
    nextElementId += 1;
  };
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    addElement(TRIANGLE_SHAPE, 3);
    addElement(QUAD_SHAPE, 4);
    addElement(TET4_SHAPE, 4);
    addElement(HEX8_SHAPE, 8);
    addElement(LINE_SHAPE, 2);
    addElement(POINT_SHAPE, 1);
  }
  return createElementModel(nodes, elements);
}

interface BudgetCase {
  readonly name: string;
  readonly description: string;
  readonly budgetMs: number;
  readonly run: () => void;
}

/**
 * Wall-clock ceilings for representative CPU workloads. Budgets are roughly
 * 10x the measured medians on a developer laptop (see `wiki/engineering/benchmarks.md`),
 * so they absorb CI noise and only trip on order-of-magnitude or asymptotic
 * regressions — e.g. a visibility update that starts scanning the whole model
 * instead of a single part. Recalibrate with
 * `PERF_REPORT=1 npx vitest run test/bench/budget.test.ts`.
 */
const budgets: readonly BudgetCase[] = [
  {
    name: "flattenAssembly",
    description: `shallow model, ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 500,
    run: () => {
      flattenAssembly({
        assemblyId: shallowScene.rootAssemblyId,
        assemblies: shallowScene.assemblies,
        visibleAssemblyIds: shallowScene.visibleAssemblyIds,
        visiblePartIds: shallowScene.visiblePartIds,
      });
    },
  },
  {
    name: "createSceneRuntime",
    description: `packed compile, ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      createSceneRuntime(shallowScene);
    },
  },
  {
    name: "createSceneRuntime (deep hierarchy)",
    description: `nested transforms, ${BENCH_HIERARCHY_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      createSceneRuntime(deepScene);
    },
  },
  {
    name: "batchInstancesByPart",
    description: `${BENCH_INSTANCE_COUNT} instances over ${BENCH_PART_COUNT} parts`,
    budgetMs: 100,
    run: () => {
      batchInstancesByPart(flattened);
    },
  },
  {
    name: "setPartVisible toggle",
    description: "part with 1000 instances, hide then show",
    budgetMs: 10,
    run: () => {
      runtime.setPartVisible(1, false);
      runtime.setPartVisible(1, true);
    },
  },
  {
    name: "setAssemblyVisible toggle",
    description: "subcase subtree with 2000 instances, hide then show",
    budgetMs: 10,
    run: () => {
      runtime.setAssemblyVisible(2, false);
      runtime.setAssemblyVisible(2, true);
    },
  },
  {
    name: "setInstanceVisible toggle",
    description: "single instance override, hide then show",
    budgetMs: 10,
    run: () => {
      runtime.setInstanceVisible(0, false);
      runtime.setInstanceVisible(0, true);
    },
  },
  {
    name: "setNodeTransform subtree",
    description: "recompose 2000-instance subtree",
    budgetMs: 10,
    run: () => {
      runtime.setNodeTransform(1, translation(10, 0, 0));
      runtime.setNodeTransform(1, translation(20, 0, 0));
    },
  },
  {
    name: "getDrawList",
    description: `${BENCH_INSTANCE_COUNT} visible instances`,
    budgetMs: 20,
    run: () => {
      runtime.getDrawList();
    },
  },
  {
    name: "resolvePick",
    description: `${PICK_COUNT} lookups on ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 50,
    run: () => {
      for (const pickId of pickIds) {
        resolvePick(flattened, pickId);
      }
    },
  },
  {
    name: "heterogeneousElementParts",
    description: "600 mixed linear elements grouped into reusable primitive parts",
    budgetMs: 500,
    run: () => {
      heterogeneousElementParts({ triangle: 901, line: 902, point: 903 }, heterogeneousModel);
    },
  },
];

function report(name: string, description: string, measuredMs: number): void {
  if (process.env["PERF_REPORT"] === undefined) {
    return;
  }
  console.log(`${name.padEnd(38)} ${description.padEnd(46)} ${measuredMs.toFixed(3)} ms`);
}

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

  it("toggles visibility on a part with a known instance count", () => {
    const delta = runtime.setPartVisible(1, false);
    expect(delta.changedInstanceIds).toHaveLength(
      (BENCH_PLACEMENTS_PER_SUBCASE / BENCH_PART_COUNT) * BENCH_SUBCASE_COUNT,
    );
    runtime.setPartVisible(1, true);
    expect(runtime.visibleCount).toBe(BENCH_INSTANCE_COUNT);
  });
});
