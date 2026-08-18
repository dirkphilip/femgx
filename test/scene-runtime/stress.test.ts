import { describe, expect, it } from "vitest";
import { createPart, type Part } from "../../src/geometry/part";
import { identity, translation } from "../../src/math/mat4";
import { resolvePick } from "../../src/picking/pick";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { AssemblyDefinition, Placement } from "../../src/scene/assembly";
import type { Scene } from "../../src/scene/scene";
import type { PartId } from "../../src/geometry/part";
import type { AssemblyId, PartOccurrence } from "../../src/scene/types";

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
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array(),
    primitive: "triangles" as const,
  };
  return createPart(id, { geometries: [geometry] });
}

function stressScene(): Scene {
  const parts = new Map<PartId, Part>();
  for (let id = 1; id <= STRESS_PART_COUNT; id += 1) {
    parts.set(id, part(id));
  }
  const assemblies = new Map<AssemblyId, AssemblyDefinition>();
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

describe("large-model stress", () => {
  it("produces stable and unique instance identities at scale", () => {
    const instances = runtimeInstances(createPackedSceneRuntime(scene));
    const ids = new Set<string>();
    for (const instance of instances) {
      expect(ids.has(instance.partOccurrenceId)).toBe(false);
      ids.add(instance.partOccurrenceId);
    }
    expect(ids.size).toBe(STRESS_INSTANCE_COUNT);
  });

  it("matches part distribution to the placement cycle", () => {
    const instances = runtimeInstances(createPackedSceneRuntime(scene));
    const perPart = Math.ceil(STRESS_PLACEMENTS_PER_SUBCASE / STRESS_PART_COUNT);
    for (const [partId, count] of countsByPart(instances)) {
      expect(count, `part ${partId} instance count`).toBe(perPart * STRESS_SUBCASES);
    }
  });

  it("compiles the packed runtime for the full model", () => {
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.visibleCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.getDrawList()).toHaveLength(STRESS_INSTANCE_COUNT);
  });

  it("keeps packed slots and runtime-derived identities aligned at scale", () => {
    const runtime = createPackedSceneRuntime(scene);
    const instances = runtimeInstances(runtime);
    expect(runtime.instanceCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.visibleCount).toBe(STRESS_INSTANCE_COUNT);
    expect(runtime.getDrawList()).toHaveLength(STRESS_INSTANCE_COUNT);
    const handle = runtime.getInstanceId(0);
    expect(handle).toBe(instances[0]?.partOccurrenceId);
  });

  it("resolves picks round-trip through runtime-derived instances", () => {
    const instances = runtimeInstances(createPackedSceneRuntime(scene));
    for (const pickId of [0, 1, STRESS_INSTANCE_COUNT / 2, STRESS_INSTANCE_COUNT - 1]) {
      const resolved = resolvePick(instances, pickId);
      expect(resolved?.partOccurrenceId).toBe(instances[pickId]?.partOccurrenceId);
    }
    expect(resolvePick(instances, STRESS_INSTANCE_COUNT)).toBeUndefined();
    expect(resolvePick(instances, -1)).toBeUndefined();
  });
});

function countsByPart(instances: readonly PartOccurrence[]): ReadonlyMap<PartId, number> {
  const counts = new Map<PartId, number>();
  for (const instance of instances) {
    counts.set(instance.partId, (counts.get(instance.partId) ?? 0) + 1);
  }
  return counts;
}

function runtimeInstances(
  runtime: ReturnType<typeof createPackedSceneRuntime>,
): readonly PartOccurrence[] {
  const instances: PartOccurrence[] = [];
  const drawList = runtime.getDrawList();
  for (let index = 0; index < drawList.length; index += 1) {
    const slot = drawList[index];
    if (slot === undefined) continue;
    const partOccurrenceId = runtime.getInstanceId(slot);
    const partId = runtime.getPartId(slot);
    const worldTransform = runtime.getTransform(slot);
    if (partOccurrenceId === undefined || partId === undefined || worldTransform === undefined)
      continue;
    instances.push({ partOccurrenceId, partId, worldTransform });
  }
  return instances;
}
