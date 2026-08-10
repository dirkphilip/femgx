import { describe, expect, it } from "vitest";
import {
  createElementFixture,
  createHex20CylinderFixture,
  type ElementFixture,
} from "../../../demo/fixture/element-fixture";
import { flattenAssembly } from "../../../src/runtime/flatten";
import type { Instance } from "../../../src/scene/types";

function flatten(fixture: ElementFixture): readonly Instance[] {
  return flattenAssembly({
    assemblyId: fixture.scene.rootAssemblyId,
    assemblies: fixture.scene.assemblies,
    visibleAssemblyIds: fixture.scene.visibleAssemblyIds,
    visiblePartIds: fixture.scene.visiblePartIds,
  });
}

describe("createElementFixture", () => {
  it("builds one reusable part for every supported shape", () => {
    const fixture = createElementFixture();
    expect(fixture.partIds).toEqual({
      point: 1,
      line: 2,
      line3: 3,
      tet4: 4,
      tet10: 5,
      hex8: 6,
      hex20: 7,
    });
    expect(fixture.instanceCount).toBe(7);
    expect(fixture.scene.parts.size).toBe(7);
    expect(flatten(fixture)).toHaveLength(7);
  });

  it("places every shape example at a stable x offset", () => {
    const fixture = createElementFixture();
    const origins = new Map(
      flatten(fixture).map((instance) => [instance.partId, instance.worldTransform[12]]),
    );
    expect(origins.get(fixture.partIds.point)).toBe(0);
    expect(origins.get(fixture.partIds.line)).toBe(3);
    expect(origins.get(fixture.partIds.line3)).toBe(6);
    expect(origins.get(fixture.partIds.tet4)).toBe(9);
    expect(origins.get(fixture.partIds.hex20)).toBe(18);
  });

  it("keeps all volume shapes visible in each display mode", () => {
    const fixture = createElementFixture();
    const volumes = [
      fixture.partIds.tet4,
      fixture.partIds.tet10,
      fixture.partIds.hex8,
      fixture.partIds.hex20,
    ];
    for (const mode of ["solid", "surface", "edges"] as const) {
      expect(fixture.modePartIds.get(mode)).toEqual(volumes);
    }
    expect(fixture.overlayPartIds).toEqual([
      fixture.partIds.point,
      fixture.partIds.line,
      fixture.partIds.line3,
    ]);
    expect(new Set([...volumes, ...fixture.overlayPartIds]).size).toBe(7);
  });

  it("produces geometry for points, lines, Tet4, and Hex20", () => {
    const { scene, partIds } = createElementFixture();
    expect(scene.parts.get(partIds.point)?.geometry.primitive).toBe("points");
    expect(scene.parts.get(partIds.line)?.geometry.primitive).toBe("lines");
    expect(scene.parts.get(partIds.line3)?.geometry.primitive).toBe("lines");
    expect(scene.parts.get(partIds.tet4)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.hex20)?.geometry.primitive).toBe("triangles");
  });

  it("builds a curved Hex20 cylinder with a bounded height", () => {
    const fixture = createHex20CylinderFixture();
    expect(fixture.scene.parts.size).toBe(2);
    expect(flatten(fixture).map((instance) => instance.worldTransform[12])).toEqual([0, 0]);
    expect(fixture.bounds.minZ).toBeCloseTo(-0.9);
    expect(fixture.bounds.maxZ).toBeCloseTo(0.9);
  });

  it("rejects invalid gallery options", () => {
    expect(() => createElementFixture({ gridSize: 0 })).toThrow("gridSize");
    expect(() => createElementFixture({ gridSize: 1.5 })).toThrow("gridSize");
    expect(() => createElementFixture({ cellSize: 0 })).toThrow("cellSize");
    expect(() => createElementFixture({ cellSize: NaN })).toThrow("cellSize");
  });
});
