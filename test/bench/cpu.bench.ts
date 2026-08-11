import { bench, describe } from "vitest";
import { translation } from "../../src/math/mat4";
import { instanceToTarget, resolvePick } from "../../src/picking/pick";
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

const runtime = createSceneRuntime(shallowScene);
const runtimeInstances = Array.from(runtime.getDrawList(), (slot, index) => ({
  index,
  instanceId: runtime.getInstanceId(slot) ?? "",
  partId: runtime.getPartId(slot) ?? 0,
  worldTransform: runtime.getTransform(slot) ?? new Float32Array(16),
}));
const PICK_COUNT = 50_000;
const pickIds: number[] = [];
for (let i = 0; i < PICK_COUNT; i++) {
  pickIds.push(i % runtimeInstances.length);
}

describe("hierarchy compile", () => {
  bench(`createSceneRuntime ${BENCH_INSTANCE_COUNT} instances`, () => {
    createSceneRuntime(shallowScene);
  });

  bench(`createSceneRuntime deep hierarchy ${BENCH_HIERARCHY_INSTANCE_COUNT} instances`, () => {
    createSceneRuntime(deepScene);
  });
});

describe("scene-runtime updates", () => {
  bench("setPartVisible toggle (1000-instance part)", () => {
    runtime.setPartVisible(1, false);
    runtime.setPartVisible(1, true);
  });

  bench("setAssemblyVisible toggle (2000-instance subcase)", () => {
    runtime.setAssemblyVisible(2, false);
    runtime.setAssemblyVisible(2, true);
  });

  bench("setInstanceVisible toggle (single instance)", () => {
    runtime.setInstanceVisible(0, false);
    runtime.setInstanceVisible(0, true);
  });

  bench("setNodeTransform (2000-instance subtree)", () => {
    runtime.setNodeTransform(1, translation(10, 0, 0));
    runtime.setNodeTransform(1, translation(20, 0, 0));
  });

  bench(`getDrawList ${BENCH_INSTANCE_COUNT} visible`, () => {
    runtime.getDrawList();
  });
});

describe("CPU picking", () => {
  bench(`resolvePick ${PICK_COUNT} lookups`, () => {
    for (const pickId of pickIds) {
      resolvePick(runtimeInstances, pickId);
    }
  });

  bench(`instanceToTarget ${PICK_COUNT} lookups`, () => {
    for (const pickId of pickIds) {
      const instance = resolvePick(runtimeInstances, pickId);
      if (instance !== undefined) {
        instanceToTarget(instance, true);
      }
    }
  });
});
