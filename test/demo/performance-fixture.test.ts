import { describe, expect, it } from "vitest";
import { createPerformancePreset } from "../../demo/fixture/performance-fixture";

describe("createPerformancePreset", () => {
  it("creates a reusable 2,097,152-triangle shell instancing case", () => {
    const preset = createPerformancePreset();
    const part = preset.scene.parts.get(1);
    if (part === undefined) throw new Error("performance fixture part is missing");
    const geometry = part.geometries[0];
    if (geometry?.primitive !== "triangles")
      throw new Error("performance fixture is not triangles");

    expect(preset.id).toBe("performance");
    expect(geometry.indices.length).toBe(128 * 128 * 6);
    expect(part.nodePositions).toBe(geometry.positions);
    expect(geometry.nodePickIds).toHaveLength(129 * 129);
    expect(part.elements).toHaveLength(128 * 128);
    expect(geometry.faces).toHaveLength(128 * 128);
    expect(preset.scene.assemblies.get(preset.scene.rootAssemblyId)?.placements).toHaveLength(64);
    expect((geometry.indices.length / 3) * 64).toBe(2_097_152);
  });
});
