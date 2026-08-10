import { describe, expect, it } from "vitest";
import {
  createBoltedPlateFixture,
  type BoltedPlateFixture,
} from "../../../demo/fixture/bolted-plate";
import { createBoltedPlatePreset, visiblePartIdsForPreset } from "../../../demo/fixture/presets";
import { transformPoint } from "../../../src/math/mat4";
import { flattenAssembly } from "../../../src/runtime/flatten";
import type { Assembly, SubAssemblyPlacement } from "../../../src/scene/assembly";
import type { Instance } from "../../../src/scene/types";

function flatten(fixture: BoltedPlateFixture): readonly Instance[] {
  const { scene } = fixture;
  return flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
}

/** The display name of a registered assembly, when it carries one. */
function assemblyName(assembly: Assembly | undefined): string | undefined {
  return (assembly as { readonly name?: string }).name;
}

/** Merges the world bounds of every placed part into one box. */
function worldBounds(fixture: BoltedPlateFixture) {
  const { scene } = fixture;
  let result = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const instance of flatten(fixture)) {
    const part = scene.parts.get(instance.partId);
    if (part === undefined) continue;
    for (const x of [part.bounds.minX, part.bounds.maxX]) {
      for (const y of [part.bounds.minY, part.bounds.maxY]) {
        for (const z of [part.bounds.minZ, part.bounds.maxZ]) {
          const [px, py, pz] = transformPoint(instance.worldTransform, x, y, z);
          result = {
            minX: Math.min(result.minX, px),
            minY: Math.min(result.minY, py),
            minZ: Math.min(result.minZ, pz),
            maxX: Math.max(result.maxX, px),
            maxY: Math.max(result.maxY, py),
            maxZ: Math.max(result.maxZ, pz),
          };
        }
      }
    }
  }
  return result;
}

describe("createBoltedPlateFixture", () => {
  it("builds a bolted lap joint with documented dimensions and stable ids", () => {
    const fixture = createBoltedPlateFixture();
    expect(fixture.dimensions).toEqual({
      plateLength: 30,
      plateWidth: 14,
      plateThickness: 2,
      overlapOffset: 6,
      fastenerRows: [-4, 10],
      fastenerColumns: [-4.5, -1.5, 1.5, 4.5],
    });
    expect(fixture.partIds).toEqual({
      plate: { solid: 1, surface: 2, edges: 3 },
      bolt: { solid: 4, surface: 5, edges: 6 },
      washer: { solid: 7, surface: 8, edges: 9 },
      nut: { solid: 10, surface: 11, edges: 12 },
    });
    expect(fixture.assemblyIds.root).toBe(1);
    expect(fixture.assemblyIds.plateStack).toBe(2);
    expect(fixture.assemblyIds.fasteners).toBe(3);
    expect(fixture.assemblyIds.fastener).toBe(4);
    expect(fixture.assemblyIds.washers).toBe(5);
    expect(fixture.instanceCount).toBe(102);
    expect(fixture.visibleInstanceCount).toBe(34);
    expect(fixture.scene.parts.size).toBe(12);
    expect(fixture.scene.assemblies.size).toBe(5);
  });

  it("nests the plate stack and fastener groups under the root", () => {
    const { scene, assemblyIds } = createBoltedPlateFixture();
    const root = scene.assemblies.get(assemblyIds.root);
    const nested = root?.placements.filter((placement) => placement.kind === "assembly") ?? [];
    expect(nested.map((placement) => placement.assemblyId)).toEqual([
      assemblyIds.plateStack,
      assemblyIds.fasteners,
    ]);

    const plateStack = scene.assemblies.get(assemblyIds.plateStack);
    expect(plateStack?.placements).toHaveLength(6);
    expect(plateStack?.placements.every((placement) => placement.kind === "part")).toBe(true);
    expect(plateStack?.placements[0]).toMatchObject({ kind: "part", partId: 1 });

    const fasteners = scene.assemblies.get(assemblyIds.fasteners);
    const fastenerPlacements = fasteners?.placements ?? [];
    expect(fastenerPlacements.every((placement) => placement.kind === "assembly")).toBe(true);
    const fastenerNested = fastenerPlacements.filter(
      (placement): placement is SubAssemblyPlacement => placement.kind === "assembly",
    );
    expect(fastenerNested).toHaveLength(8);
    expect(fastenerNested.every((placement) => placement.assemblyId === assemblyIds.fastener)).toBe(
      true,
    );
    expect(new Set(fastenerNested.map((placement) => placement.transform[12]))).toEqual(
      new Set([-4, 10]),
    );
    expect(new Set(fastenerNested.map((placement) => placement.transform[14]))).toEqual(
      new Set([-4.5, -1.5, 1.5, 4.5]),
    );
  });

  it("nests reusable bolt, washers, and nut definitions under the fastener", () => {
    const { scene, assemblyIds } = createBoltedPlateFixture();
    const fastener = scene.assemblies.get(assemblyIds.fastener);
    expect(assemblyName(fastener)).toBe("Fastener");
    expect(fastener?.placements).toHaveLength(7);
    const placementKinds = fastener?.placements.map((placement) => placement.kind) ?? [];
    expect(placementKinds).toEqual(["part", "part", "part", "assembly", "part", "part", "part"]);

    const washers = scene.assemblies.get(assemblyIds.washers);
    expect(assemblyName(washers)).toBe("Washers");
    expect(washers?.placements).toHaveLength(6);
    expect(washers?.placements.every((placement) => placement.kind === "part")).toBe(true);
    expect(washers?.placements[0]).toMatchObject({ kind: "part", partId: 7 });
    expect(washers?.placements[3]).toMatchObject({ kind: "part", partId: 7 });
    expect(fastener?.placements[3]).toMatchObject({
      kind: "assembly",
      assemblyId: assemblyIds.washers,
    });
  });

  it("reuses the shared parts across the full instance list", () => {
    const fixture = createBoltedPlateFixture();
    const instances = flatten(fixture);
    expect(instances).toHaveLength(102);
    const counts = new Map<number, number>();
    for (const instance of instances) {
      counts.set(instance.partId, (counts.get(instance.partId) ?? 0) + 1);
    }
    expect(counts).toEqual(
      new Map([
        [1, 2],
        [2, 2],
        [3, 2],
        [4, 8],
        [5, 8],
        [6, 8],
        [7, 16],
        [8, 16],
        [9, 16],
        [10, 8],
        [11, 8],
        [12, 8],
      ]),
    );
    expect(new Set(instances.map((instance) => instance.partId)).size).toBe(12);
  });

  it("places plates in the lap-joint overlap and fasteners in rows and columns", () => {
    const fixture = createBoltedPlateFixture();
    const instances = flatten(fixture);
    const plates = instances.filter((instance) => instance.partId === 1);
    expect(plates.map((instance) => instance.worldTransform[12])).toEqual([0, 6]);
    expect(plates.map((instance) => instance.worldTransform[13])).toEqual([0, 2]);

    const bolts = instances.filter((instance) => instance.partId === 4);
    const boltPositions = new Set(
      bolts.map((instance) => `${instance.worldTransform[12]},${instance.worldTransform[14]}`),
    );
    expect(boltPositions).toEqual(
      new Set(["-4,-4.5", "-4,-1.5", "-4,1.5", "-4,4.5", "10,-4.5", "10,-1.5", "10,1.5", "10,4.5"]),
    );

    const washers = instances.filter((instance) => instance.partId === 7);
    expect(washers).toHaveLength(16);
    const washerHeights = washers.map((instance) => instance.worldTransform[13] ?? 0);
    expect(washerHeights.some((height) => Math.abs(height - 3.175) < 1e-6)).toBe(true);
    expect(washerHeights.some((height) => Math.abs(height + 1.175) < 1e-6)).toBe(true);

    const nuts = instances.filter((instance) => instance.partId === 10);
    expect(nuts).toHaveLength(8);
    expect(
      nuts.every((instance) => Math.abs((instance.worldTransform[13] ?? 0) + 1.85) < 1e-6),
    ).toBe(true);
  });

  it("produces deterministic, stable instance ordering", () => {
    const fixture = createBoltedPlateFixture();
    const instances = flatten(fixture);
    expect(instances[0]?.instanceId).toBe("1/0/0");
    expect(instances[5]?.instanceId).toBe("1/0/5");
    expect(instances[6]?.instanceId).toBe("1/1/0/0");
    expect(instances[9]?.instanceId).toBe("1/1/0/3/0");
    expect(instances[12]?.instanceId).toBe("1/1/0/3/3");
    expect(instances[15]?.instanceId).toBe("1/1/0/4");
    expect(instances[18]?.instanceId).toBe("1/1/1/0");
    expect(instances[instances.length - 1]?.instanceId).toBe("1/1/7/6");
  });

  it("reports the model bounds including protruding fasteners", () => {
    expect(worldBounds(createBoltedPlateFixture())).toEqual({
      minX: -15,
      minY: -4,
      minZ: -7,
      maxX: 21,
      maxY: 4.349999904632568,
      maxZ: 7,
    });
    expect(createBoltedPlatePreset().bounds).toEqual({
      minX: -15,
      minY: -4,
      minZ: -7,
      maxX: 21,
      maxY: 4.349999904632568,
      maxZ: 7,
    });
  });

  it("exposes CPU geometry per mode with computed bounds", () => {
    const { scene, partIds } = createBoltedPlateFixture();
    const plateSolid = scene.parts.get(partIds.plate.solid);
    expect(plateSolid?.geometry.primitive).toBe("triangles");
    expect(plateSolid?.geometry.indices).toHaveLength(132);
    const plateEdges = scene.parts.get(partIds.plate.edges);
    expect(plateEdges?.geometry.primitive).toBe("lines");
    const boltModel = createBoltedPlateFixture().elementModels.get(partIds.bolt.solid);
    expect(boltModel?.elements).toHaveLength(2);
    expect(scene.parts.get(partIds.bolt.solid)?.bounds).toEqual({
      minX: -0.699999988079071,
      minY: -4,
      minZ: -0.699999988079071,
      maxX: 0.699999988079071,
      maxY: 4.349999904632568,
      maxZ: 0.699999988079071,
    });
  });

  it("produces identical output on repeated calls", () => {
    const first = flatten(createBoltedPlateFixture());
    const second = flatten(createBoltedPlateFixture());
    expect(first.map((instance) => instance.instanceId)).toEqual(
      second.map((instance) => instance.instanceId),
    );
    expect(first.map((instance) => instance.worldTransform[12])).toEqual(
      second.map((instance) => instance.worldTransform[12]),
    );
  });

  it("respects custom options and recomputes bounds and counts", () => {
    const fixture = createBoltedPlateFixture({
      plateLength: 20,
      plateThickness: 1,
      overlapOffset: 4,
    });
    expect(fixture.dimensions.plateLength).toBe(20);
    expect(fixture.dimensions.plateThickness).toBe(1);
    expect(fixture.instanceCount).toBe(102);
    expect(fixture.visibleInstanceCount).toBe(34);
    expect(worldBounds(fixture)).toEqual({
      minX: -10,
      minY: -4,
      minZ: -7,
      maxX: 14,
      maxY: 2.8499999046325684,
      maxZ: 7,
    });
  });

  it("rejects invalid options", () => {
    expect(() => createBoltedPlateFixture({ plateLength: 0 })).toThrow("plateLength");
    expect(() => createBoltedPlateFixture({ plateWidth: NaN })).toThrow("plateWidth");
    expect(() => createBoltedPlateFixture({ plateThickness: -1 })).toThrow("plateThickness");
    expect(() => createBoltedPlateFixture({ overlapOffset: 0 })).toThrow("overlapOffset");
  });
});

describe("createBoltedPlatePreset", () => {
  it("resolves the default mode part set plus overlays", () => {
    const preset = createBoltedPlatePreset();
    expect(preset.id).toBe("bolted");
    expect(preset.name).toBe("Bolted plate assembly");
    expect(preset.defaultMode).toBe("solid");
    expect(visiblePartIdsForPreset(preset, "solid")).toEqual(new Set([1, 4, 7, 10]));
    expect(preset.partColors.size).toBe(12);
    expect(preset.overlayPartIds).toEqual([]);
    const visible = visiblePartIdsForPreset(preset, "solid");
    const { scene } = preset;
    const instances = flattenAssembly({
      assemblyId: scene.rootAssemblyId,
      assemblies: scene.assemblies,
      visibleAssemblyIds: scene.visibleAssemblyIds,
      visiblePartIds: visible,
    });
    expect(instances).toHaveLength(34);
  });
});
