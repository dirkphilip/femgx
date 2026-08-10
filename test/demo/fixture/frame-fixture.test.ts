import { describe, expect, it } from "vitest";
import { buildFrameModel, createFrameFixture } from "../../../demo/fixture/frame-fixture";
import { flattenAssembly } from "../../../src/runtime/flatten";

describe("buildFrameModel", () => {
  it("builds a conforming hex mesh with shared joint nodes", () => {
    const model = buildFrameModel();
    expect(model.elements).toHaveLength(38);
    expect(model.elements.every((element) => element.shape.family === "hex")).toBe(true);
    const ids = new Set(model.elements.map((element) => element.id));
    expect(ids.size).toBe(38);
    // The column-beam joint at grid (0,5,0) is shared between both bricks.
    const joint = model.nodes.findIndex(
      (_, index) =>
        index % 3 === 0 &&
        model.nodes[index] === 0 &&
        model.nodes[index + 1] === 5 &&
        model.nodes[index + 2] === 0,
    );
    expect(joint).toBeGreaterThanOrEqual(0);
    const users = model.elements.filter((element) => element.nodeIds.includes(joint));
    expect(users.length).toBeGreaterThanOrEqual(2);
  });
});

describe("createFrameFixture", () => {
  it("builds three reusable parts over one model", () => {
    const fixture = createFrameFixture();
    expect(fixture.partIds).toEqual({ solid: 1, surface: 2, edges: 3 });
    expect(fixture.instanceCount).toBe(3);
    expect(fixture.scene.parts.size).toBe(3);
    expect(fixture.scene.assemblies.size).toBe(1);
    expect(fixture.elementModels.get(1)).toEqual(fixture.elementModels.get(2));
  });

  it("exposes solid, surface, and edges geometry", () => {
    const { scene, partIds } = createFrameFixture();
    expect(scene.parts.get(partIds.solid)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.surface)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.edges)?.geometry.primitive).toBe("lines");
  });

  it("maps every mode to its part", () => {
    const fixture = createFrameFixture();
    expect(fixture.modePartIds).toEqual(
      new Map([
        ["solid", [fixture.partIds.solid]],
        ["surface", [fixture.partIds.surface]],
        ["edges", [fixture.partIds.edges]],
      ]),
    );
  });

  it("produces deterministic, stable instances", () => {
    const fixture = createFrameFixture();
    const instances = flattenAssembly({
      assemblyId: fixture.scene.rootAssemblyId,
      assemblies: fixture.scene.assemblies,
      visibleAssemblyIds: fixture.scene.visibleAssemblyIds,
      visiblePartIds: fixture.scene.visiblePartIds,
    });
    expect(instances.map((instance) => instance.instanceId)).toEqual(["1/0", "1/1", "1/2"]);
    expect(fixture.bounds).toEqual({
      minX: 0,
      minY: -1,
      minZ: -1,
      maxX: 7,
      maxY: 6,
      maxZ: 2,
    });
  });
});
