import { describe, expect, it } from "vitest";
import {
  ELEMENT_GALLERY_ENTRIES,
  createElementFixture,
  createHex20CylinderFixture,
  type ElementFixture,
} from "../../../demo/fixtures/element-fixture";
import { buildMeshEdgeData } from "../../../src/renderer/edges/mesh-edge";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { transformPoint, type Bounds, type Part } from "../../../src/entries/root";
import type { Instance } from "../../../src/scene/types";
import { ElementShape } from "../../../src/elements/shapes";

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
    instances.push({ instanceId, partId, worldTransform });
  }
  return instances;
}

function nonZeroNodeIds(part: Part): number[] {
  const geometry = part.geometries[0];
  if (geometry === undefined) return [];
  return [...new Set(Array.from(geometry.nodePickIds ?? []).filter((id) => id !== 0))].sort(
    (a, b) => a - b,
  );
}

function transformedBounds(bounds: Bounds, transform: Float32Array): Bounds {
  let result: Bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        const [px, py, pz] = transformPoint(transform, x, y, z);
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
  return result;
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
      wedge6: 13,
      pyramid5: 14,
      mixed: 15,
    });
    expect(fixture.instanceCount).toBe(15);
    expect(fixture.scene.parts.size).toBe(15);
    expect(runtimeInstances(fixture)).toHaveLength(15);
  });

  it("uses one complete, ordered inventory with unique comparison cells", () => {
    const fixture = createElementFixture();
    expect(ELEMENT_GALLERY_ENTRIES).toHaveLength(fixture.instanceCount);
    expect(new Set(ELEMENT_GALLERY_ENTRIES.map((entry) => entry.partId)).size).toBe(
      ELEMENT_GALLERY_ENTRIES.length,
    );
    expect(
      new Set(ELEMENT_GALLERY_ENTRIES.map((entry) => entry.cell.join(":")).values()).size,
    ).toBe(ELEMENT_GALLERY_ENTRIES.length);
    expect(new Set(ELEMENT_GALLERY_ENTRIES.map((entry) => entry.category))).toEqual(
      new Set(["0d-1d", "2d", "3d"]),
    );
    expect(
      ELEMENT_GALLERY_ENTRIES.filter((entry) => entry.category === "3d").map(
        (entry) => entry.order,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ELEMENT_GALLERY_ENTRIES.map((entry) => entry.partId).sort((a, b) => a - b)).toEqual(
      [...fixture.scene.parts.keys()].sort((a, b) => a - b),
    );
  });

  it("centers every placed bounds within its cell and normalizes the 3D outliers", () => {
    const fixture = createElementFixture();
    const instances = new Map(
      runtimeInstances(fixture).map((instance) => [instance.partId, instance]),
    );
    for (const entry of ELEMENT_GALLERY_ENTRIES) {
      const instance = instances.get(entry.partId);
      const part = fixture.scene.parts.get(entry.partId);
      if (instance === undefined || part === undefined) throw new Error(`Missing ${entry.partId}`);
      const bounds = transformedBounds(part.bounds, instance.worldTransform);
      const [column, row] = entry.cell;
      expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(column * 3 + 1);
      expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(row * 3 + 1);
      expect((bounds.minZ + bounds.maxZ) / 2).toBeCloseTo(1);
      expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(2.001);
      expect(bounds.maxY - bounds.minY).toBeLessThanOrEqual(2.001);
      expect(bounds.maxZ - bounds.minZ).toBeLessThanOrEqual(2.001);
    }
    for (const partId of [fixture.partIds.wedge6, fixture.partIds.pyramid5]) {
      const instance = instances.get(partId);
      if (instance === undefined) throw new Error(`Missing 3D outlier ${partId}`);
      const part = fixture.scene.parts.get(partId);
      if (part === undefined) throw new Error(`Missing 3D part ${partId}`);
      const bounds = transformedBounds(part.bounds, instance.worldTransform);
      expect(bounds.maxX - bounds.minX).toBeCloseTo(2);
      expect(bounds.maxY - bounds.minY).toBeCloseTo(2);
      expect(bounds.maxZ - bounds.minZ).toBeCloseTo(2);
    }
  });

  it("includes one semantic element with point, line, and triangle graphics", () => {
    const { scene, partIds } = createElementFixture();
    const mixed = scene.parts.get(partIds.mixed);

    expect(mixed?.geometries.map((geometry) => geometry.primitive)).toEqual([
      "triangles",
      "lines",
      "points",
    ]);
    expect(mixed?.elements).toEqual([
      {
        id: 1,
        primitiveRanges: [
          { primitive: "triangles", primitiveStart: 0, primitiveCount: 1 },
          { primitive: "lines", primitiveStart: 0, primitiveCount: 1 },
          { primitive: "points", primitiveStart: 0, primitiveCount: 1 },
        ],
      },
    ]);
    const nodeIds = mixed?.geometries.map((geometry) =>
      [...new Set(geometry.nodePickIds ?? [])].filter((id) => id !== 0),
    );
    expect(nodeIds).toEqual([[4, 5, 6], [2, 3], [1]]);
    expect(new Set(nodeIds?.flat()).size).toBe(6);
  });

  it("starts with every gallery part in the scene", () => {
    const fixture = createElementFixture();
    expect(
      runtimeInstances(fixture)
        .map((instance) => instance.partId)
        .sort((a, b) => a - b),
    ).toEqual([...fixture.scene.parts.keys()].sort((a, b) => a - b));
  });

  it("produces geometry for points, lines, surfaces, and linear/quadratic volumes", () => {
    const { scene, partIds } = createElementFixture();
    expect(scene.parts.get(partIds.point)?.geometries[0]?.primitive).toBe("points");
    expect(scene.parts.get(partIds.line)?.geometries[0]?.primitive).toBe("lines");
    expect(scene.parts.get(partIds.line3)?.geometries[0]?.primitive).toBe("lines");
    expect(scene.parts.get(partIds.triangle)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.tri6)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.quad)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.quad8)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.generic)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.tet4)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.hex20)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.wedge6)?.geometries[0]?.primitive).toBe("triangles");
    expect(scene.parts.get(partIds.pyramid5)?.geometries[0]?.primitive).toBe("triangles");
  });

  it("retains one indexed multi-face generic element without a typed shape", () => {
    const { scene, partIds } = createElementFixture();
    const part = scene.parts.get(partIds.generic);
    const genericGeometry = part?.geometries[0];
    if (part === undefined || genericGeometry?.primitive !== "triangles") {
      throw new Error("generic mapping part is missing");
    }
    const elements = part.elements ?? [];
    const faces = genericGeometry.faces ?? [];
    expect(elements).toHaveLength(1);
    expect(elements[0]?.id).toBe(42);
    expect(elements[0]?.shape).toBeUndefined();
    expect(faces).toHaveLength(5);
    expect(faces.map((face) => face.faceIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(faces.every((face) => face.elementId === 42)).toBe(true);
    expect(faces[0]?.primitiveCount).toBe(2);
    expect(new Set(Array.from(part.geometries[0]?.nodePickIds ?? []))).toEqual(
      new Set([1, 2, 3, 4, 5]),
    );
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
      triangle.geometries[0]?.primitive !== "triangles" ||
      tri6.geometries[0]?.primitive !== "triangles" ||
      quad.geometries[0]?.primitive !== "triangles" ||
      quad8.geometries[0]?.primitive !== "triangles"
    ) {
      throw new Error("surface parts are not triangle geometry");
    }
    const triangleElements = triangle.elements ?? [];
    const tri6Elements = tri6.elements ?? [];
    const quadElements = quad.elements ?? [];
    const quad8Elements = quad8.elements ?? [];
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

    const triangleGeometry = triangle.geometries[0];
    const quadGeometry = quad.geometries[0];
    expect(triangleGeometry.faceSubset).toBeUndefined();
    expect(quadGeometry.faceSubset).toBeUndefined();
    expect(triangleElements).toHaveLength(1);
    expect(tri6Elements).toHaveLength(1);
    expect(quadElements).toHaveLength(1);
    expect(quad8Elements).toHaveLength(1);
    expect(triangleElement.shape).toBe(ElementShape.Triangle);
    expect(tri6Element.shape).toBe(ElementShape.Tri6);
    expect(quadElement.shape).toBe(ElementShape.Quad);
    expect(quad8Element.shape).toBe(ElementShape.Quad8);
    expect(nonZeroNodeIds(triangle)).toEqual([1, 2, 3]);
    expect(nonZeroNodeIds(tri6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(nonZeroNodeIds(quad)).toEqual([2, 3, 4, 5]);
    expect(nonZeroNodeIds(quad8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(
      buildMeshEdgeData(triangleGeometry, triangleGeometry.indices, triangle.elements ?? [])
        .indices,
    ).toHaveLength(6);
    expect(
      buildMeshEdgeData(tri6.geometries[0], tri6.geometries[0].indices, tri6.elements ?? [])
        .indices,
    ).toHaveLength(12);
    expect(
      buildMeshEdgeData(quadGeometry, quadGeometry.indices, quad.elements ?? []).indices,
    ).toHaveLength(8);
    expect(
      buildMeshEdgeData(quad8.geometries[0], quad8.geometries[0].indices, quad8.elements ?? [])
        .indices,
    ).toHaveLength(16);
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
