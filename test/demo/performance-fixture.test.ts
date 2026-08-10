import { describe, expect, it } from "vitest";
import { createPerformancePreset } from "../../demo/fixture/performance-fixture";

describe("createPerformancePreset", () => {
  it("creates a reusable 2,097,152-triangle shell instancing case", () => {
    const preset = createPerformancePreset();
    const part = preset.scene.parts.get(1);

    expect(preset.id).toBe("performance");
    expect(part?.geometry.indices.length).toBe(128 * 128 * 6);
    expect(part?.geometry.nodePositions).toBe(part?.geometry.positions);
    expect(part?.geometry.nodePickIds).toHaveLength(129 * 129);
    expect(part?.geometry.elements).toHaveLength(128 * 128);
    expect(part?.geometry.faces).toHaveLength(128 * 128);
    expect(part?.geometry.facePickIds).toHaveLength(128 * 128 * 2);
    expect(preset.scene.assemblies.get(preset.scene.rootAssemblyId)?.placements).toHaveLength(64);
    expect(((part?.geometry.indices.length ?? 0) / 3) * 64).toBe(2_097_152);
  });
});
