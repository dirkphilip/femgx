import { describe, expect, it } from "vitest";
import {
  createElementFixture,
  visiblePartIdsFor,
  type ElementFixture,
} from "../../../demo/fixture/element-fixture";
import { flattenAssembly } from "../../../src/runtime/flatten";
import type { Instance } from "../../../src/scene/types";

function flatten(fixture: ElementFixture): readonly Instance[] {
  const { scene } = fixture;
  return flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
}

describe("createElementFixture", () => {
  it("builds the gallery with stable ids and one instance per part", () => {
    const fixture = createElementFixture();
    expect(fixture.partIds).toEqual({
      tetSolid: 4,
      tetSurface: 5,
      tetEdges: 6,
      hexSolid: 1,
      hexSurface: 2,
      hexEdges: 3,
      points: 7,
      lines: 8,
    });
    expect(fixture.instanceCount).toBe(8);
    expect(fixture.scene.parts.size).toBe(8);
    expect(fixture.scene.assemblies.size).toBe(1);
    expect(flatten(fixture)).toHaveLength(8);
  });

  it("places each reusable part exactly once along the x axis", () => {
    const fixture = createElementFixture();
    const instances = flatten(fixture);
    const origins = new Map<number, number>();
    for (const instance of instances) {
      origins.set(instance.partId, instance.worldTransform[12] as number);
    }
    expect(origins.get(fixture.partIds.hexSolid)).toBe(0);
    expect(origins.get(fixture.partIds.tetSolid)).toBe(3);
    expect(origins.get(fixture.partIds.points)).toBe(6);
    expect(origins.get(fixture.partIds.lines)).toBe(6);
  });

  it("keys mode part ids to the three volume render modes", () => {
    const fixture = createElementFixture();
    expect(fixture.defaultMode).toBe("solid");
    expect(fixture.modePartIds).toEqual(
      new Map([
        ["solid", [fixture.partIds.tetSolid, fixture.partIds.hexSolid]],
        ["surface", [fixture.partIds.tetSurface, fixture.partIds.hexSurface]],
        ["edges", [fixture.partIds.tetEdges, fixture.partIds.hexEdges]],
      ]),
    );
    expect(fixture.overlayPartIds).toEqual([fixture.partIds.points, fixture.partIds.lines]);
  });

  it("resolves visible part sets per mode plus overlays", () => {
    const fixture = createElementFixture();
    expect(visiblePartIdsFor(fixture, "solid")).toEqual(
      new Set([
        fixture.partIds.tetSolid,
        fixture.partIds.hexSolid,
        fixture.partIds.points,
        fixture.partIds.lines,
      ]),
    );
    expect(visiblePartIdsFor(fixture, "edges")).toEqual(
      new Set([
        fixture.partIds.tetEdges,
        fixture.partIds.hexEdges,
        fixture.partIds.points,
        fixture.partIds.lines,
      ]),
    );
  });

  it("produces identical output on repeated calls", () => {
    const first = flatten(createElementFixture());
    const second = flatten(createElementFixture());
    expect(first.map((instance) => instance.instanceId)).toEqual(
      second.map((instance) => instance.instanceId),
    );
    expect(first.map((instance) => instance.worldTransform[12])).toEqual(
      second.map((instance) => instance.worldTransform[12]),
    );
  });

  it("spans the full gallery in world bounds", () => {
    const fixture = createElementFixture();
    expect(fixture.bounds).toEqual({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 8,
      maxY: 2,
      maxZ: 2,
    });
  });

  it("exposes CPU geometry per family and mode", () => {
    const { scene, partIds } = createElementFixture();
    const hexSolid = scene.parts.get(partIds.hexSolid);
    expect(hexSolid?.geometry.primitive).toBe("triangles");
    const hexSurface = scene.parts.get(partIds.hexSurface);
    expect(hexSurface?.geometry.primitive).toBe("triangles");
    const tetEdges = scene.parts.get(partIds.tetEdges);
    expect(tetEdges?.geometry.primitive).toBe("lines");
    const points = scene.parts.get(partIds.points);
    expect(points?.geometry.primitive).toBe("points");
    const lines = scene.parts.get(partIds.lines);
    expect(lines?.geometry.primitive).toBe("lines");
  });

  it("draws quadratic Hex20 surfaces through mid-edge nodes", () => {
    const { scene, partIds } = createElementFixture();
    const surface = scene.parts.get(partIds.hexSurface);
    expect(surface?.geometry.positions).toHaveLength(1728);
    expect(surface?.geometry.indices).toHaveLength(576);
  });

  it("culls shared interior faces from quadratic Tet10 solid parts", () => {
    const { scene, partIds } = createElementFixture();
    const solid = scene.parts.get(partIds.tetSolid);
    expect(solid?.geometry.positions).toHaveLength(2304);
    expect(solid?.geometry.indices).toHaveLength(768);
  });

  it("respects custom grid options and recomputes bounds", () => {
    const fixture = createElementFixture({ gridSize: 1, cellSize: 0.5 });
    expect(fixture.instanceCount).toBe(8);
    expect(fixture.bounds).toEqual({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 3.5,
      maxY: 0.5,
      maxZ: 0.5,
    });
  });

  it("rejects invalid options", () => {
    expect(() => createElementFixture({ gridSize: 0 })).toThrow("gridSize");
    expect(() => createElementFixture({ gridSize: 1.5 })).toThrow("gridSize");
    expect(() => createElementFixture({ cellSize: 0 })).toThrow("cellSize");
    expect(() => createElementFixture({ cellSize: NaN })).toThrow("cellSize");
  });
});
