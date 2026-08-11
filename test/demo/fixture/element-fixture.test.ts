import { describe, expect, it } from "vitest";
import {
  createElementFixture,
  createHex20CylinderFixture,
  type ElementFixture,
} from "../../../demo/fixture/element-fixture";
import { createSceneRuntime } from "../../../src/scene-runtime/runtime";
import type { Instance } from "../../../src/scene/types";

function runtimeInstances(fixture: Pick<ElementFixture, "scene">): readonly Instance[] {
  const runtime = createSceneRuntime(fixture.scene);
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

describe("createElementFixture", () => {
  it("builds one reusable part for every supported shape", () => {
    const fixture = createElementFixture();
    expect(fixture.partIds).toEqual({
      point: 1,
      line: 2,
      line3: 3,
      triangle: 8,
      quad: 9,
      polygon: 10,
      tet4: 4,
      tet10: 5,
      hex8: 6,
      hex20: 7,
    });
    expect(fixture.instanceCount).toBe(10);
    expect(fixture.scene.parts.size).toBe(10);
    expect(runtimeInstances(fixture)).toHaveLength(10);
  });

  it("places every shape example at a stable x offset", () => {
    const fixture = createElementFixture();
    const origins = new Map(
      runtimeInstances(fixture).map((instance) => [instance.partId, instance.worldTransform[12]]),
    );
    expect(origins.get(fixture.partIds.point)).toBe(0);
    expect(origins.get(fixture.partIds.line)).toBe(3);
    expect(origins.get(fixture.partIds.line3)).toBe(6);
    expect(origins.get(fixture.partIds.tet4)).toBe(9);
    expect(origins.get(fixture.partIds.hex20)).toBe(18);
    expect(origins.get(fixture.partIds.triangle)).toBe(21);
    expect(origins.get(fixture.partIds.quad)).toBe(24);
    expect(origins.get(fixture.partIds.polygon)).toBe(27);
  });

  it("keeps all volume shapes visible in each display mode", () => {
    const fixture = createElementFixture();
    const volumes = [
      fixture.partIds.tet4,
      fixture.partIds.tet10,
      fixture.partIds.hex8,
      fixture.partIds.hex20,
      fixture.partIds.triangle,
      fixture.partIds.quad,
      fixture.partIds.polygon,
    ];
    for (const mode of ["solid", "surface", "edges"] as const) {
      expect(fixture.modePartIds.get(mode)).toEqual(volumes);
    }
    expect(fixture.overlayPartIds).toEqual([
      fixture.partIds.point,
      fixture.partIds.line,
      fixture.partIds.line3,
    ]);
    expect(new Set([...volumes, ...fixture.overlayPartIds]).size).toBe(10);
  });

  it("produces geometry for points, lines, triangle, Tet4, and Hex20", () => {
    const { scene, partIds } = createElementFixture();
    expect(scene.parts.get(partIds.point)?.geometry.primitive).toBe("points");
    expect(scene.parts.get(partIds.line)?.geometry.primitive).toBe("lines");
    expect(scene.parts.get(partIds.line3)?.geometry.primitive).toBe("lines");
    expect(scene.parts.get(partIds.triangle)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.quad)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.polygon)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.tet4)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.hex20)?.geometry.primitive).toBe("triangles");
  });

  it("builds a curved Hex20 cylinder with a bounded height", () => {
    const fixture = createHex20CylinderFixture();
    expect(fixture.scene.parts.size).toBe(1);
    expect(fixture.overlayPartIds).toEqual([]);
    expect(runtimeInstances(fixture).map((instance) => instance.worldTransform[12])).toEqual([0]);
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
