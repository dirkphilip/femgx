import { describe, expect, it } from "vitest";
import { createPanelFixture, type PanelFixture } from "../../src/fixture/panel";
import { flattenAssembly } from "../../src/runtime/flatten";
import type { Instance } from "../../src/scene/types";

function flatten(fixture: PanelFixture): readonly Instance[] {
  const { scene } = fixture;
  return flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
}

describe("createPanelFixture", () => {
  it("builds a panel with documented dimensions and stable ids", () => {
    const fixture = createPanelFixture();
    expect(fixture.dimensions).toEqual({
      cellSize: 1,
      cellsX: 4,
      cellsY: 3,
      stiffenerHeight: 0.5,
      width: 4,
      depth: 3,
    });
    expect(fixture.partIds).toEqual({ shell: 1, stiffenerX: 2, stiffenerY: 3 });
    expect(fixture.assemblyIds).toEqual({ root: 1, rows: [2, 3, 4], stiffenerX: 5, stiffenerY: 6 });
    expect(fixture.instanceCount).toBe(21);
    expect(fixture.scene.parts.size).toBe(3);
    expect(fixture.scene.assemblies.size).toBe(6);
  });

  it("nests a row sub-assembly per shell row under the root", () => {
    const { scene, assemblyIds } = createPanelFixture();
    const root = scene.assemblies.get(assemblyIds.root);
    const nested = root?.placements.filter((placement) => placement.kind === "assembly") ?? [];
    expect(nested.map((placement) => placement.assemblyId)).toEqual([
      ...assemblyIds.rows,
      assemblyIds.stiffenerX,
      assemblyIds.stiffenerY,
    ]);
    for (const rowId of assemblyIds.rows) {
      const row = scene.assemblies.get(rowId);
      expect(row?.placements).toHaveLength(4);
      expect(row?.placements.every((placement) => placement.kind === "part")).toBe(true);
    }
  });

  it("repeats the three reusable parts across the full instance list", () => {
    const fixture = createPanelFixture();
    const instances = flatten(fixture);
    expect(instances).toHaveLength(21);
    const counts = new Map<number, number>();
    for (const instance of instances) {
      counts.set(instance.partId, (counts.get(instance.partId) ?? 0) + 1);
    }
    expect(counts).toEqual(
      new Map([
        [fixture.partIds.shell, 12],
        [fixture.partIds.stiffenerX, 4],
        [fixture.partIds.stiffenerY, 5],
      ]),
    );
  });

  it("places shells on the grid and stiffeners to the full span", () => {
    const fixture = createPanelFixture();
    const instances = flatten(fixture);
    const shells = instances.filter((instance) => instance.partId === fixture.partIds.shell);
    const shellOrigins = shells.map((instance) => [
      instance.worldTransform[12],
      instance.worldTransform[13],
    ]);
    expect(shellOrigins).toContainEqual([0, 0]);
    expect(shellOrigins).toContainEqual([3, 0]);
    expect(shellOrigins).toContainEqual([0, 2]);
    expect(shellOrigins).toContainEqual([3, 2]);

    for (const instance of instances.filter((item) => item.partId === fixture.partIds.stiffenerX)) {
      expect(instance.worldTransform[0]).toBeCloseTo(4);
      expect(instance.worldTransform[10]).toBeCloseTo(0.5);
    }
    for (const instance of instances.filter((item) => item.partId === fixture.partIds.stiffenerY)) {
      expect(instance.worldTransform[5]).toBeCloseTo(3);
      expect(instance.worldTransform[10]).toBeCloseTo(0.5);
    }
  });

  it("produces identical output on repeated calls", () => {
    const first = flatten(createPanelFixture());
    const second = flatten(createPanelFixture());
    expect(first.map((instance) => instance.instanceId)).toEqual(
      second.map((instance) => instance.instanceId),
    );
    expect(first.map((instance) => instance.worldTransform[12])).toEqual(
      second.map((instance) => instance.worldTransform[12]),
    );
  });

  it("keeps placement handles deterministic and readable", () => {
    const instances = flatten(createPanelFixture());
    expect(instances[0]?.instanceId).toBe("1/0/0");
    expect(instances[11]?.instanceId).toBe("1/2/3");
  });

  it("respects custom options and recomputes dimensions and counts", () => {
    const fixture = createPanelFixture({
      cellsX: 2,
      cellsY: 2,
      cellSize: 0.5,
      stiffenerHeight: 0.25,
    });
    expect(fixture.dimensions).toEqual({
      cellSize: 0.5,
      cellsX: 2,
      cellsY: 2,
      stiffenerHeight: 0.25,
      width: 1,
      depth: 1,
    });
    expect(fixture.instanceCount).toBe(10);
    expect(fixture.assemblyIds.rows).toEqual([2, 3]);
    expect(flatten(fixture)).toHaveLength(10);
  });

  it("exposes WebGPU-independent CPU geometry with computed bounds", () => {
    const { scene } = createPanelFixture();
    const shell = scene.parts.get(1);
    expect(shell?.geometry.positions).toHaveLength(12);
    expect(shell?.geometry.indices).toHaveLength(6);
    expect(shell?.bounds).toEqual({
      minX: -0.5,
      minY: -0.5,
      minZ: 0,
      maxX: 0.5,
      maxY: 0.5,
      maxZ: 0,
    });
  });

  it("rejects invalid options", () => {
    expect(() => createPanelFixture({ cellsX: 0 })).toThrow("cellsX");
    expect(() => createPanelFixture({ cellsY: -1 })).toThrow("cellsY");
    expect(() => createPanelFixture({ cellSize: 0 })).toThrow("cellSize");
    expect(() => createPanelFixture({ stiffenerHeight: NaN })).toThrow("stiffenerHeight");
  });
});
