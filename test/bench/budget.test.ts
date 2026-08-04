import { describe, expect, it } from "vitest";
import { batchInstancesByPart } from "../../src/runtime/batch";
import { compileScene } from "../../src/runtime/compile";
import { cullInstances } from "../../src/runtime/culling";
import { flattenAssembly } from "../../src/runtime/flatten";
import { translation } from "../../src/math/mat4";
import { resolvePick } from "../../src/picking/pick";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";
import { createCamera, viewProjectionMatrix } from "../../src/camera/camera";
import { parseChunk } from "../../src/streaming/parser";
import { buildSpatialGrid, cullChunks } from "../../src/streaming/spatial";
import { createChunkStream } from "../../src/streaming/stream";
import {
  BENCH_CHUNK_COUNT,
  BENCH_CHUNK_VERTEX_COUNT,
  BENCH_CHUNK_VERTICES_PER_CHUNK,
  BENCH_HIERARCHY_DEPTH,
  BENCH_HIERARCHY_FANOUT,
  BENCH_HIERARCHY_INSTANCE_COUNT,
  BENCH_HIERARCHY_PARTS_PER_LEAF,
  BENCH_INSTANCE_COUNT,
  BENCH_PART_COUNT,
  BENCH_PLACEMENTS_PER_SUBCASE,
  BENCH_SUBCASE_COUNT,
  makeChunkSources,
  makeHierarchyScene,
  makeLodChunkSources,
  makeScene,
  makeViewProjection,
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

const viewProjection = makeViewProjection();

const chunks = makeChunkSources({
  chunkCount: BENCH_CHUNK_COUNT,
  verticesPerChunk: BENCH_CHUNK_VERTICES_PER_CHUNK,
});
const chunkGrid = buildSpatialGrid(chunks, 100_000);

const lodChunks = makeLodChunkSources({
  chunkCount: BENCH_CHUNK_COUNT,
  verticesPerChunk: BENCH_CHUNK_VERTICES_PER_CHUNK,
});
const lodGrid = buildSpatialGrid(lodChunks, 100_000);
const lodCamera = createCamera({
  position: [0, 0, 0],
  target: [BENCH_CHUNK_VERTEX_COUNT, 0, 0],
  far: BENCH_CHUNK_VERTEX_COUNT * 4,
  fovY: Math.PI / 1.5,
});
const lodViewProjection = viewProjectionMatrix(lodCamera);
const lodOptions = {
  cameraPosition: lodCamera.position,
  detailThresholds: [100_000, 1_000_000],
};
const lodSelection = cullChunks(lodGrid, lodViewProjection, lodOptions);

const PICK_COUNT = 50_000;
const pickIds: number[] = [];
for (let i = 0; i < PICK_COUNT; i++) {
  pickIds.push(i % flattened.length);
}

interface BudgetCase {
  readonly name: string;
  readonly description: string;
  readonly budgetMs: number;
  readonly run: () => void;
}

/**
 * Wall-clock ceilings for representative CPU workloads. Budgets are roughly
 * 10x the measured medians on a developer laptop (see `wiki/benchmarks.md`),
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
    name: "compileScene",
    description: `flatten + batch, ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 500,
    run: () => {
      compileScene(shallowScene);
    },
  },
  {
    name: "compileScene with frustum culling",
    description: `flatten + cull + batch, ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      compileScene(shallowScene, { viewProjection });
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
    name: "cullInstances",
    description: `${BENCH_INSTANCE_COUNT} instances against one frustum`,
    budgetMs: 300,
    run: () => {
      cullInstances(flattened, shallowScene.parts, viewProjection);
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
    name: "parseChunk",
    description: `parse ${BENCH_CHUNK_COUNT} chunks, ${BENCH_CHUNK_VERTEX_COUNT} vertices`,
    budgetMs: 100,
    run: () => {
      for (const source of chunks) {
        parseChunk(source);
      }
    },
  },
  {
    name: "parseChunk mixed-detail model",
    description: `parse ${BENCH_CHUNK_COUNT} selected LOD chunks across 3 detail levels`,
    budgetMs: 150,
    run: () => {
      for (const source of lodSelection) {
        parseChunk(source);
      }
    },
  },
  {
    name: "buildSpatialGrid",
    description: `partition ${BENCH_CHUNK_COUNT} chunks`,
    budgetMs: 50,
    run: () => {
      buildSpatialGrid(chunks, 100_000);
    },
  },
  {
    name: "cullChunks",
    description: `${BENCH_CHUNK_COUNT} chunks against one frustum`,
    budgetMs: 50,
    run: () => {
      cullChunks(chunkGrid, viewProjection);
    },
  },
  {
    name: "createChunkStream full load",
    description: `stream ${BENCH_CHUNK_COUNT} chunks, ${BENCH_CHUNK_VERTEX_COUNT} vertices`,
    budgetMs: 100,
    run: () => {
      const stream = createChunkStream(chunks);
      while (!stream.tick()) {
        /* pump */
      }
    },
  },
  {
    name: "createChunkStream LOD selection",
    description: `cull + stream ${BENCH_CHUNK_COUNT} mixed-detail chunks`,
    budgetMs: 150,
    run: () => {
      const stream = createChunkStream(cullChunks(lodGrid, lodViewProjection, lodOptions));
      while (!stream.tick()) {
        /* pump */
      }
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
        `${budget.budgetMs} ms budget; see wiki/benchmarks.md`,
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
