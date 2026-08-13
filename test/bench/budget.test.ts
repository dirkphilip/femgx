import { describe, expect, it } from "vitest";
import { createStructuredFeModel } from "../../demo/benchmark/structured-fe";
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
import { createPart } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import { resolvePick } from "../../src/picking/pick";
import { buildMeshEdgeData } from "../../src/renderer/gpu-edge";
import { buildPrimitiveFaceBodyPickData } from "../../src/renderer/gpu-pick-ids";
import { expandSurfaceGeometry } from "../../src/renderer/gpu-surface-geometry";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { sceneWorldBounds } from "../../src/viewport/scene-bounds";
import {
  BENCH_BODY_COUNT,
  BENCH_BODY_ELEMENT_COUNT,
  BENCH_BODY_GRID_CELLS,
  BENCH_HIERARCHY_DEPTH,
  BENCH_HIERARCHY_FANOUT,
  BENCH_HIERARCHY_INSTANCE_COUNT,
  BENCH_HIERARCHY_PARTS_PER_LEAF,
  BENCH_INSTANCE_COUNT,
  BENCH_PART_COUNT,
  BENCH_PLACEMENTS_PER_SUBCASE,
  BENCH_SUBCASE_COUNT,
  makeHierarchyScene,
  makeBodyGeometry,
  makeBodies,
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

const runtime = createPackedSceneRuntime(shallowScene);
const runtimeInstances = Array.from(runtime.getDrawList(), (slot, index) => ({
  index,
  instanceId: runtime.getInstanceId(slot) ?? "",
  partId: runtime.getPartId(slot) ?? 0,
  worldTransform: runtime.getTransform(slot) ?? new Float32Array(16),
}));

const heterogeneousModel = makeHeterogeneousModel(100);
const bodyGeometry = makeBodyGeometry();
const boundsPart = createPart(906, bodyGeometry);
const boundsScene = {
  rootAssemblyId: 1,
  parts: new Map([[boundsPart.id, boundsPart]]),
  assemblies: new Map([
    [
      1,
      {
        id: 1,
        placements: Array.from({ length: 64 }, (_, index) => ({
          kind: "part" as const,
          partId: boundsPart.id,
          transform: translation(index, 0, 0),
        })),
      },
    ],
  ]),
  visiblePartIds: new Set([boundsPart.id]),
  visibleAssemblyIds: new Set([1]),
};
const boundsRuntime = createPackedSceneRuntime(boundsScene);
const bodyModel = createStructuredFeModel("quad", BENCH_BODY_GRID_CELLS);
const bodies = makeBodies(bodyModel.elements.length, BENCH_BODY_COUNT);
const bodyModelWithBodies = createElementModel([...bodyModel.nodes], bodyModel.elements, {
  bodies,
});
const LINE_BENCH_SEGMENTS = 10_000;
const lineHeavyGeometry = {
  positions: Float32Array.from({ length: (LINE_BENCH_SEGMENTS + 1) * 3 }, (_, index) => index % 3),
  indices: Uint32Array.from(
    { length: LINE_BENCH_SEGMENTS * 2 },
    (_, index) => Math.floor(index / 2) + (index % 2),
  ),
  primitive: "lines" as const,
};

const PICK_COUNT = 50_000;
const pickIds: number[] = [];
for (let i = 0; i < PICK_COUNT; i++) {
  pickIds.push(i % runtimeInstances.length);
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
    name: "createPackedSceneRuntime",
    description: `packed compile, ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      createPackedSceneRuntime(shallowScene);
    },
  },
  {
    name: "createPackedSceneRuntime (deep hierarchy)",
    description: `nested transforms, ${BENCH_HIERARCHY_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      createPackedSceneRuntime(deepScene);
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
    name: "getDrawList",
    description: `${BENCH_INSTANCE_COUNT} visible instances`,
    budgetMs: 20,
    run: () => {
      runtime.getDrawList();
    },
  },
  {
    name: "sceneWorldBounds",
    description: "32,768 triangles reused across 64 placements",
    budgetMs: 100,
    run: () => {
      sceneWorldBounds(boundsScene, boundsRuntime);
    },
  },
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
  {
    name: "heterogeneousElementParts",
    description: "600 mixed linear elements grouped into reusable primitive parts",
    budgetMs: 500,
    run: () => {
      heterogeneousElementParts({ triangle: 901, line: 902, point: 903 }, heterogeneousModel);
    },
  },
  {
    name: "expand line geometry",
    description: `${LINE_BENCH_SEGMENTS} authored segments into reusable quads`,
    budgetMs: 100,
    run: () => {
      expandSurfaceGeometry(lineHeavyGeometry);
    },
  },
  {
    name: "createPart (body-heavy)",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 100,
    run: () => {
      createPart(904, bodyGeometry);
    },
  },
  {
    name: "buildPrimitiveFaceBodyPickData",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 25,
    run: () => {
      buildPrimitiveFaceBodyPickData(bodyGeometry);
    },
  },
  {
    name: "buildMeshEdgeData (body-heavy)",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 600,
    run: () => {
      buildMeshEdgeData(bodyGeometry);
    },
  },
  {
    name: "heterogeneousElementParts (body-heavy)",
    description: `${BENCH_BODY_ELEMENT_COUNT} FE quads across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 600,
    run: () => {
      heterogeneousElementParts({ triangle: 905 }, bodyModelWithBodies);
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
