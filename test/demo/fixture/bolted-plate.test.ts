import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../../demo/fixture/bolted-plate";
import { createBoltedPlatePreset } from "../../../demo/fixture/presets";
import { sceneBounds } from "../../../demo/scene-bounds";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import type { Assembly, SubAssemblyPlacement } from "../../../src/scene/assembly";
import type { Scene } from "../../../src/scene/scene";
import type { Instance } from "../../../src/scene/types";

function runtimeInstances(scene: Scene): readonly Instance[] {
  const runtime = createPackedSceneRuntime(scene);
  const instances: Instance[] = [];
  const drawList = runtime.getDrawList();
  for (let index = 0; index < drawList.length; index += 1) {
    const slot = drawList[index];
    if (slot === undefined) continue;
    const instanceId = runtime.getInstanceId(slot);
    const partId = runtime.getPartId(slot);
    const worldTransform = runtime.getTransform(slot);
    if (instanceId === undefined || partId === undefined || worldTransform === undefined) continue;
    instances.push({ index, instanceId, partId, worldTransform });
  }
  return instances;
}

/** The display name of a registered assembly, when it carries one. */
function assemblyName(assembly: Assembly | undefined): string | undefined {
  return (assembly as { readonly name?: string }).name;
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
      plate: { partId: 1 },
      bolt: { partId: 4 },
      washer: { partId: 7 },
      nut: { partId: 10 },
    });
    expect(fixture.assemblyIds.root).toBe(1);
    expect(fixture.assemblyIds.plateStack).toBe(2);
    expect(fixture.assemblyIds.fasteners).toBe(3);
    expect(fixture.assemblyIds.fastener).toBe(4);
    expect(fixture.assemblyIds.washers).toBe(5);
    expect(fixture.instanceCount).toBe(34);
    expect(fixture.visibleInstanceCount).toBe(34);
    expect(fixture.scene.parts.size).toBe(4);
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
    expect(plateStack?.placements).toHaveLength(2);
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
    expect(fastener?.placements).toHaveLength(3);
    const placementKinds = fastener?.placements.map((placement) => placement.kind) ?? [];
    expect(placementKinds).toEqual(["part", "assembly", "part"]);

    const washers = scene.assemblies.get(assemblyIds.washers);
    expect(assemblyName(washers)).toBe("Washers");
    expect(washers?.placements).toHaveLength(2);
    expect(washers?.placements.every((placement) => placement.kind === "part")).toBe(true);
    expect(washers?.placements[0]).toMatchObject({ kind: "part", partId: 7 });
    expect(washers?.placements[1]).toMatchObject({ kind: "part", partId: 7 });
    expect(fastener?.placements[1]).toMatchObject({
      kind: "assembly",
      assemblyId: assemblyIds.washers,
    });
  });

  it("reuses the shared parts across the full instance list", () => {
    const fixture = createBoltedPlateFixture();
    const instances = runtimeInstances(fixture.scene);
    expect(instances).toHaveLength(34);
    const counts = new Map<number, number>();
    for (const instance of instances) {
      counts.set(instance.partId, (counts.get(instance.partId) ?? 0) + 1);
    }
    expect(counts).toEqual(
      new Map([
        [1, 2],
        [4, 8],
        [7, 16],
        [10, 8],
      ]),
    );
    expect(new Set(instances.map((instance) => instance.partId)).size).toBe(4);
  });

  it("places plates in the lap-joint overlap and fasteners in rows and columns", () => {
    const fixture = createBoltedPlateFixture();
    const instances = runtimeInstances(fixture.scene);
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
    const instances = runtimeInstances(fixture.scene);
    expect(instances[0]?.instanceId).toBe("1/0/0");
    expect(instances[1]?.instanceId).toBe("1/0/1");
    expect(instances[2]?.instanceId).toBe("1/1/0/0");
    expect(instances[3]?.instanceId).toBe("1/1/0/1/0");
    expect(instances[4]?.instanceId).toBe("1/1/0/1/1");
    expect(instances[5]?.instanceId).toBe("1/1/0/2");
    expect(instances[instances.length - 1]?.instanceId).toBe("1/1/7/2");
  });

  it("reports the model bounds including protruding fasteners", () => {
    expect(sceneBounds(createBoltedPlateFixture().scene)).toEqual({
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
    const plateSolid = scene.parts.get(partIds.plate.partId);
    expect(plateSolid?.geometries[0]?.primitive).toBe("triangles");
    expect(plateSolid?.geometries[0]?.indices).toHaveLength(216);
    const plateGeometry = plateSolid?.geometries[0];
    if (plateGeometry?.primitive !== "triangles") throw new Error("expected plate triangles");
    const interfaceFaces = (plateGeometry.faces ?? []).filter(
      (face) => face.neighborElementIds.length > 0,
    );
    expect(interfaceFaces).toHaveLength(14);
    expect(new Set(interfaceFaces.map((face) => face.key)).size).toBe(7);
    const boltModel = createBoltedPlateFixture().elementModels.get(partIds.bolt.partId);
    expect(boltModel?.elements).toHaveLength(2);
    expect(scene.parts.get(partIds.bolt.partId)?.bounds).toEqual({
      minX: -0.699999988079071,
      minY: -4,
      minZ: -0.699999988079071,
      maxX: 0.699999988079071,
      maxY: 4.349999904632568,
      maxZ: 0.699999988079071,
    });
  });

  it("produces identical output on repeated calls", () => {
    const first = runtimeInstances(createBoltedPlateFixture().scene);
    const second = runtimeInstances(createBoltedPlateFixture().scene);
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
    expect(fixture.instanceCount).toBe(34);
    expect(fixture.visibleInstanceCount).toBe(34);
    expect(sceneBounds(fixture.scene)).toEqual({
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
  it("starts with every reusable component visible", () => {
    const preset = createBoltedPlatePreset();
    expect(preset.id).toBe("bolted");
    expect(preset.name).toBe("Bolted plate assembly");
    expect(preset.partColors.size).toBe(4);
    const instances = runtimeInstances(preset.scene);
    expect(instances).toHaveLength(34);
  });
});
