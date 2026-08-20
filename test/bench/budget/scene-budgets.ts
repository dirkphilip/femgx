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
} from "../fixtures";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneOccurrenceSnapshot } from "@/scene-runtime/occurrences";
import { translationMatrix, createPart } from "@/entries/root";
import { SceneNavigationBoundsCache, sceneWorldBounds } from "@/viewport/scene-bounds";
import type { BudgetCase, ScalingCase } from "./types";
import { bodyGeometry } from "./geometry-fixtures";

const RUNTIME_SCALING_PLACEMENTS = [50_000, 100_000, BENCH_INSTANCE_COUNT] as const;
const runtimeScalingScenes = RUNTIME_SCALING_PLACEMENTS.map((placementCount) =>
  makeScene({
    subcaseCount: BENCH_SUBCASE_COUNT,
    placementsPerSubcase: placementCount / BENCH_SUBCASE_COUNT,
    partCount: BENCH_PART_COUNT,
  }),
);
const shallowScene = runtimeScalingScenes.at(-1);
if (shallowScene === undefined) throw new Error("Runtime scaling scenes are missing");

const deepScene = makeHierarchyScene({
  depth: BENCH_HIERARCHY_DEPTH,
  fanout: BENCH_HIERARCHY_FANOUT,
  partsPerLeaf: BENCH_HIERARCHY_PARTS_PER_LEAF,
  partCount: BENCH_PART_COUNT,
});

const runtime = createPackedSceneRuntime(shallowScene);
const runtimeInstances = Array.from(runtime.getDrawList(), (slot, index) => ({
  index,
  partOccurrenceId: runtime.getInstanceId(slot) ?? "",
  partId: runtime.getPartId(slot) ?? 0,
  worldTransform: runtime.getTransform(slot) ?? new Float32Array(16),
}));

const boundsPart = createPart(906, {
  geometries: [bodyGeometry.geometry],
  elements: bodyGeometry.elements,
  nodePositions: bodyGeometry.nodePositions,
  ...(bodyGeometry.bodies === undefined ? {} : { bodies: bodyGeometry.bodies }),
});
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
          transform: translationMatrix(index, 0, 0),
        })),
      },
    ],
  ]),
  visiblePartIds: new Set([boundsPart.id]),
  visibleAssemblyIds: new Set([1]),
};
const boundsRuntime = createPackedSceneRuntime(boundsScene);
const navigationBoundsCache = new SceneNavigationBoundsCache();
navigationBoundsCache.get(boundsScene, boundsRuntime);

export const sceneBudgets: readonly BudgetCase[] = [
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
    description: "single part-occurrence override, hide then show",
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
    name: "cached navigation bounds",
    description: "1,000 zoom-time reads of 32,768 triangles across 64 placements",
    budgetMs: 2,
    run: () => {
      for (let index = 0; index < 1_000; index += 1) {
        navigationBoundsCache.get(boundsScene, boundsRuntime);
      }
    },
  },
];

export const sceneScalingCases: readonly ScalingCase[] = [
  {
    name: "public scene runtime rebuild",
    description: "inspect 50k–200k compiled placements",
    points: runtimeScalingScenes.map((scene, index) => ({
      size: RUNTIME_SCALING_PLACEMENTS[index] ?? 0,
      run: () => {
        createSceneOccurrenceSnapshot(scene);
      },
    })),
    maxNormalizedSpread: 3,
  },
];

export { runtime, runtimeInstances, BENCH_PLACEMENTS_PER_SUBCASE };
