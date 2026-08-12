import { describe, expect, it } from "vitest";
import {
  createElementFixture,
  createHex20CylinderFixture,
  type ElementFixture,
} from "../../../demo/fixture/element-fixture";
import { buildMeshEdgeData } from "../../../src/renderer/gpu-edge";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import type { Instance } from "../../../src/scene/types";

function runtimeInstances(fixture: Pick<ElementFixture, "scene">): readonly Instance[] {
  const runtime = createPackedSceneRuntime(fixture.scene);
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

function nonZeroNodeIds(part: {
  readonly geometry: { readonly nodePickIds?: Uint32Array };
}): number[] {
  return [...new Set(Array.from(part.geometry.nodePickIds ?? []).filter((id) => id !== 0))].sort(
    (a, b) => a - b,
  );
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

  it("places every shape example in a stable two-row comparison grid", () => {
    const fixture = createElementFixture();
    const origins = new Map(
      runtimeInstances(fixture).map((instance) => [
        instance.partId,
        [instance.worldTransform[12], instance.worldTransform[13]],
      ]),
    );
    expect(origins).toEqual(
      new Map([
        [fixture.partIds.point, [0, 0]],
        [fixture.partIds.line, [3, 0]],
        [fixture.partIds.line3, [6, 0]],
        [fixture.partIds.triangle, [9, 0]],
        [fixture.partIds.quad, [12, 0]],
        [fixture.partIds.polygon, [0, 3]],
        [fixture.partIds.tet4, [3, 3]],
        [fixture.partIds.tet10, [6, 3]],
        [fixture.partIds.hex8, [9, 3]],
        [fixture.partIds.hex20, [12, 3]],
      ]),
    );
  });

  it("starts with every gallery part in the scene", () => {
    const fixture = createElementFixture();
    expect(
      runtimeInstances(fixture)
        .map((instance) => instance.partId)
        .sort((a, b) => a - b),
    ).toEqual([...fixture.scene.parts.keys()].sort((a, b) => a - b));
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

  it("keeps authored triangle and quad nodes and boundary edges separate", () => {
    const { scene, partIds } = createElementFixture();
    const triangle = scene.parts.get(partIds.triangle);
    const quad = scene.parts.get(partIds.quad);
    if (triangle === undefined || quad === undefined) throw new Error("surface parts are missing");
    if (triangle.geometry.primitive !== "triangles" || quad.geometry.primitive !== "triangles") {
      throw new Error("surface parts are not triangle geometry");
    }
    const triangleElements = triangle.geometry.elements;
    const quadElements = quad.geometry.elements;
    if (triangleElements === undefined || quadElements === undefined) {
      throw new Error("surface element descriptors are missing");
    }
    const triangleElement = triangleElements[0];
    const quadElement = quadElements[0];
    if (
      triangleElement === undefined ||
      quadElement === undefined ||
      triangleElement.shape === undefined ||
      quadElement.shape === undefined
    ) {
      throw new Error("surface element descriptors are empty");
    }

    expect(triangle.geometry.faceSubset).toBeUndefined();
    expect(quad.geometry.faceSubset).toBeUndefined();
    expect(triangleElements).toHaveLength(1);
    expect(quadElements).toHaveLength(1);
    expect(triangleElement.shape.family).toBe("triangle");
    expect(quadElement.shape.family).toBe("quad");
    expect(nonZeroNodeIds(triangle)).toEqual([1, 2, 3]);
    expect(nonZeroNodeIds(quad)).toEqual([2, 3, 4, 5]);

    expect(buildMeshEdgeData(triangle.geometry).indices).toHaveLength(6);
    expect(buildMeshEdgeData(quad.geometry).indices).toHaveLength(8);
  });

  it("builds a linearly tessellated Hex20 cylinder with a bounded height", () => {
    const fixture = createHex20CylinderFixture();
    expect(fixture.scene.parts.size).toBe(1);
    expect(runtimeInstances(fixture).map((instance) => instance.worldTransform[12])).toEqual([0]);
    const part = fixture.scene.parts.get(fixture.partIds.hex20);
    expect(part?.bounds.minZ).toBeCloseTo(-0.9);
    expect(part?.bounds.maxZ).toBeCloseTo(0.9);
  });

  it("rejects invalid gallery options", () => {
    expect(() => createElementFixture({ gridSize: 0 })).toThrow("gridSize");
    expect(() => createElementFixture({ gridSize: 1.5 })).toThrow("gridSize");
    expect(() => createElementFixture({ cellSize: 0 })).toThrow("cellSize");
    expect(() => createElementFixture({ cellSize: NaN })).toThrow("cellSize");
  });
});
