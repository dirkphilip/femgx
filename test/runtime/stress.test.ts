import { describe, expect, it } from "vitest";
import { computeBounds, type Part } from "../../src/geometry/part";
import { identity, translation } from "../../src/math/mat4";
import { resolvePick } from "../../src/picking/pick";
import { batchInstancesByPart } from "../../src/runtime/batch";
import { cullInstances } from "../../src/runtime/culling";
import { flattenAssembly } from "../../src/runtime/flatten";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";
import type { Assembly, Placement } from "../../src/scene/assembly";
import type { Scene } from "../../src/scene/scene";
import type { AssemblyId, Instance, PartId } from "../../src/scene/types";

/**
 * Large-model stress coverage: verifies that the CPU scene pipeline preserves
 * deterministic order, stable instance identities, part distribution, and pick
 * round-trips at scale. Model sizes are explicit so failures always identify
 * the invariant that broke, complementing the wall-clock budgets in
 * `test/bench/budget.test.ts` (see `wiki/engineering/benchmarks.md`).
 */
const STRESS_SUBCASES = 80;
const STRESS_PLACEMENTS_PER_SUBCASE = 2_000;
const STRESS_PART_COUNT = 40;
const STRESS_INSTANCE_COUNT = STRESS_SUBCASES * STRESS_PLACEMENTS_PER_SUBCASE;

function part(id: PartId): Part {
  const geometry = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array() };
  return { id, geometry, bounds: computeBounds(geometry) };
}

function stressScene(): Scene {
  const parts = new Map<PartId, Part>();
  for (let id = 1; id <= STRESS_PART_COUNT; id += 1) {
    parts.set(id, part(id));
  }
  const assemblies = new Map<AssemblyId, Assembly>();
  const rootPlacements: Placement[] = [];
  for (let subcase = 0; subcase < STRESS_SUBCASES; subcase += 1) {
    const subcaseId = subcase + 2;
    const placements: Placement[] = [];
    for (let i = 0; i < STRESS_PLACEMENTS_PER_SUBCASE; i += 1) {
      placements.push({
        kind: "part",
        partId: (i % STRESS_PART_COUNT) + 1,
        transform: translation(i * 0.001, subcase, 0),
      });
    }
    assemblies.set(subcaseId, { id: subcaseId, placements });
    rootPlacements.push({ kind: "assembly", assemblyId: subcaseId, transform: identity() });
  }
  assemblies.set(1, { id: 1, placements: rootPlacements });
  return {
    rootAssemblyId: 1,
    parts,
    assemblies,
    visiblePartIds: new Set(parts.keys()),
    visibleAssemblyIds: new Set(assemblies.keys()),
  };
}

const scene = stressScene();

/** A scene whose placements all lie inside the unit-cube identity frustum. */
function cullingScene(): Scene {
  const parts = new Map<PartId, Part>();
  for (let id = 1; id <= STRESS_PART_COUNT; id += 1) {
    parts.set(id, part(id));
  }
  const assemblies = new Map<AssemblyId, Assembly>();
  const rootPlacements: Placement[] = [];
  for (let subcase = 0; subcase < STRESS_SUBCASES; subcase += 1) {
    const subcaseId = subcase + 2;
    const placements: Placement[] = [];
    for (let i = 0; i < STRESS_PLACEMENTS_PER_SUBCASE; i += 1) {
      placements.push({
        kind: "part",
        partId: (i % STRESS_PART_COUNT) + 1,
        transform: identity(),
      });
    }
    assemblies.set(subcaseId, { id: subcaseId, placements });
    rootPlacements.push({ kind: "assembly", assemblyId: subcaseId, transform: identity() });
  }
  assemblies.set(1, { id: 1, placements: rootPlacements });
  return {
    rootAssemblyId: 1,
    parts,
    assemblies,
    visiblePartIds: new Set(parts.keys()),
    visibleAssemblyIds: new Set(assemblies.keys()),
  };
}

describe("large-model stress", () => {
  it("flattens the full model with a deterministic instance list", () => {
    const instances = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: scene.visiblePartIds,
    });
    expect(instances).toHaveLength(STRESS_INSTANCE_COUNT);
    expect(instances[0]?.index).toBe(0);
    expect(instances[STRESS_INSTANCE_COUNT - 1]?.index).toBe(STRESS_INSTANCE_COUNT - 1);
  });

  it("produces stable and unique instance identities at scale", () => {
    const instances = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: scene.visiblePartIds,
    });
    const ids = new Set<string>();
    for (const instance of instances) {
      expect(ids.has(instance.instanceId)).toBe(false);
      ids.add(instance.instanceId);
    }
    expect(ids.size).toBe(STRESS_INSTANCE_COUNT);
  });

  it("matches part distribution to the placement cycle", () => {
    const instances = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: scene.visiblePartIds,
    });
    const perPart = Math.ceil(STRESS_PLACEMENTS_PER_SUBCASE / STRESS_PART_COUNT);
    for (const [partId, count] of countsByPart(instances)) {
      expect(count, `part ${partId} instance count`).toBe(perPart * STRESS_SUBCASES);
    }
  });

  it("batches instances by part while preserving source order", () => {
    const instances = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: scene.visiblePartIds,
    });
    const batches = batchInstancesByPart(instances);
    expect(batches).toHaveLength(STRESS_PART_COUNT);
    let total = 0;
    for (const batch of batches) {
      total += batch.instances.length;
      for (const instance of batch.instances) {
        expect(instance.partId).toBe(batch.partId);
      }
    }
    expect(total).toBe(STRESS_INSTANCE_COUNT);
  });

  it("compiles the packed runtime for the full model", () => {
    const runtime = createSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.visibleCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.getDrawList()).toHaveLength(STRESS_INSTANCE_COUNT);
  });

  it("culling preserves instance identity and part distribution", () => {
    const cullScene = cullingScene();
    const culledList = flattenAssembly({
      assemblyId: cullScene.rootAssemblyId,
      assemblies: cullScene.assemblies,
      visibleAssemblyIds: cullScene.visibleAssemblyIds,
      visiblePartIds: cullScene.visiblePartIds,
    });
    const viewProjection = new Float32Array(16);
    viewProjection[0] = 1;
    viewProjection[5] = 1;
    viewProjection[10] = 1;
    viewProjection[15] = 1;
    const culled = cullInstances(culledList, cullScene.parts, viewProjection);
    expect(culled.length).toBe(STRESS_INSTANCE_COUNT);
    expect(culled.map((instance) => instance.instanceId)).toEqual(
      culledList.map((instance) => instance.instanceId),
    );
    expect(countsByPart(culled)).toEqual(countsByPart(culledList));
  });

  it("the packed runtime matches the flattened model at scale", () => {
    const runtime = createSceneRuntime(scene);
    const flattened = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: scene.visiblePartIds,
    });
    expect(runtime.instanceCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.visibleCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.getDrawList()).toHaveLength(STRESS_INSTANCE_COUNT);
    const handle = runtime.getInstanceId(0);
    expect(handle).toBe(flattened[0]?.instanceId);
  });

  it("resolves picks round-trip through the flattened model", () => {
    const instances = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: scene.visiblePartIds,
    });
    for (const pickId of [0, 1, STRESS_INSTANCE_COUNT / 2, STRESS_INSTANCE_COUNT - 1]) {
      const resolved = resolvePick(instances, pickId);
      expect(resolved?.index).toBe(pickId);
      expect(resolved?.instanceId).toBe(instances[pickId]?.instanceId);
    }
    expect(resolvePick(instances, STRESS_INSTANCE_COUNT)).toBeUndefined();
    expect(resolvePick(instances, -1)).toBeUndefined();
  });
});

function countsByPart(instances: readonly Instance[]): ReadonlyMap<PartId, number> {
  const counts = new Map<PartId, number>();
  for (const instance of instances) {
    counts.set(instance.partId, (counts.get(instance.partId) ?? 0) + 1);
  }
  return counts;
}
