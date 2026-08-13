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
  it("builds one reusable part for each helper and mapping example", () => {
    const fixture = createElementFixture();
    expect(fixture.partIds).toEqual({
      point: 1,
      line: 2,
      line3: 3,
      triangle: 8,
      tri6: 11,
      quad: 9,
      quad8: 12,
      generic: 10,
      tet4: 4,
      tet10: 5,
      hex8: 6,
      hex20: 7,
    });
    expect(fixture.instanceCount).toBe(12);
    expect(fixture.scene.parts.size).toBe(12);
    expect(runtimeInstances(fixture)).toHaveLength(12);
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
        [fixture.partIds.tri6, [15, 0]],
        [fixture.partIds.generic, [0, 3]],
        [fixture.partIds.tet4, [3, 3]],
        [fixture.partIds.tet10, [6, 3]],
        [fixture.partIds.hex8, [9, 3]],
        [fixture.partIds.hex20, [12, 3]],
        [fixture.partIds.quad8, [15, 3]],
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

  it("produces geometry for points, lines, linear/quadratic surfaces, Tet4, and Hex20", () => {
    const { scene, partIds } = createElementFixture();
    expect(scene.parts.get(partIds.point)?.geometry.primitive).toBe("points");
    expect(scene.parts.get(partIds.line)?.geometry.primitive).toBe("lines");
    expect(scene.parts.get(partIds.line3)?.geometry.primitive).toBe("lines");
    expect(scene.parts.get(partIds.triangle)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.tri6)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.quad)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.quad8)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.generic)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.tet4)?.geometry.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.hex20)?.geometry.primitive).toBe("triangles");
  });

  it("retains one indexed multi-face generic element without a typed shape", () => {
    const { scene, partIds } = createElementFixture();
    const part = scene.parts.get(partIds.generic);
    if (part === undefined || part.geometry.primitive !== "triangles") {
      throw new Error("generic mapping part is missing");
    }
    const elements = part.geometry.elements ?? [];
    const faces = part.geometry.faces ?? [];
    expect(elements).toHaveLength(1);
    expect(elements[0]?.id).toBe(42);
    expect(elements[0]?.shape).toBeUndefined();
    expect(faces).toHaveLength(5);
    expect(faces.map((face) => face.faceIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(faces.every((face) => face.elementId === 42)).toBe(true);
    expect(faces[0]?.primitiveCount).toBe(2);
    expect(new Set(Array.from(part.geometry.nodePickIds ?? []))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(part.bounds).toEqual({ minX: -1, minY: -1, minZ: 0, maxX: 1, maxY: 1, maxZ: 1.5 });
  });

  it("keeps authored linear and quadratic surface nodes and boundary edges separate", () => {
    const { scene, partIds } = createElementFixture();
    const triangle = scene.parts.get(partIds.triangle);
    const tri6 = scene.parts.get(partIds.tri6);
    const quad = scene.parts.get(partIds.quad);
    const quad8 = scene.parts.get(partIds.quad8);
    if (triangle === undefined || tri6 === undefined || quad === undefined || quad8 === undefined) {
      throw new Error("surface parts are missing");
    }
    if (
      triangle.geometry.primitive !== "triangles" ||
      tri6.geometry.primitive !== "triangles" ||
      quad.geometry.primitive !== "triangles" ||
      quad8.geometry.primitive !== "triangles"
    ) {
      throw new Error("surface parts are not triangle geometry");
    }
    const triangleElements = triangle.geometry.elements;
    const tri6Elements = tri6.geometry.elements;
    const quadElements = quad.geometry.elements;
    const quad8Elements = quad8.geometry.elements;
    if (
      triangleElements === undefined ||
      tri6Elements === undefined ||
      quadElements === undefined ||
      quad8Elements === undefined
    ) {
      throw new Error("surface element descriptors are missing");
    }
    const triangleElement = triangleElements[0];
    const tri6Element = tri6Elements[0];
    const quadElement = quadElements[0];
    const quad8Element = quad8Elements[0];
    if (
      triangleElement === undefined ||
      tri6Element === undefined ||
      quadElement === undefined ||
      quad8Element === undefined ||
      triangleElement.shape === undefined ||
      tri6Element.shape === undefined ||
      quadElement.shape === undefined ||
      quad8Element.shape === undefined
    ) {
      throw new Error("surface element descriptors are empty");
    }

    expect(triangle.geometry.faceSubset).toBeUndefined();
    expect(quad.geometry.faceSubset).toBeUndefined();
    expect(triangleElements).toHaveLength(1);
    expect(tri6Elements).toHaveLength(1);
    expect(quadElements).toHaveLength(1);
    expect(quad8Elements).toHaveLength(1);
    expect(triangleElement.shape.family).toBe("triangle");
    expect(tri6Element.shape).toEqual({ family: "triangle", order: 2 });
    expect(quadElement.shape.family).toBe("quad");
    expect(quad8Element.shape).toEqual({ family: "quad", order: 2 });
    expect(nonZeroNodeIds(triangle)).toEqual([1, 2, 3]);
    expect(nonZeroNodeIds(tri6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(nonZeroNodeIds(quad)).toEqual([2, 3, 4, 5]);
    expect(nonZeroNodeIds(quad8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(buildMeshEdgeData(triangle.geometry).indices).toHaveLength(6);
    expect(buildMeshEdgeData(tri6.geometry).indices).toHaveLength(12);
    expect(buildMeshEdgeData(quad.geometry).indices).toHaveLength(8);
    expect(buildMeshEdgeData(quad8.geometry).indices).toHaveLength(16);
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
