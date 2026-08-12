import { describe, expect, it } from "vitest";
import {
  benchmarkCaseSpecs,
  createBenchmarkCase,
  estimateBenchmarkMemory,
} from "../../demo/benchmark/model";

describe("WebGPU benchmark models", () => {
  it("keeps instanced and bounded unique-geometry cases distinct", () => {
    expect(benchmarkCaseSpecs(false).map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "instanced-2.10m", kind: "instancing-heavy" },
      { id: "unique-250k", kind: "unique-geometry" },
      { id: "unique-1m", kind: "unique-geometry" },
    ]);
    expect(benchmarkCaseSpecs(true).at(-1)?.id).toBe("unique-2m-local");
  });

  it("builds one reusable grid part at the requested bounded size", () => {
    const benchmarkCase = createBenchmarkCase({
      id: "tiny-test",
      kind: "unique-geometry",
      gridCells: 2,
      instanceCount: 1,
    });
    const part = benchmarkCase.scene.parts.get(1);
    expect(part?.geometry.positions).toHaveLength(27);
    expect(part?.geometry.indices).toHaveLength(24);
    expect(part?.geometry.elements).toEqual([{ id: 0, primitiveStart: 0, primitiveCount: 8 }]);
  });

  it("reports buffer and render-target memory as an explicit sum", () => {
    const memory = estimateBenchmarkMemory(2, 3, 800, 600);
    expect(memory.totalBufferBytes).toBe(
      memory.geometryBytes +
        memory.pickMetadataBytes +
        memory.edgeIndexBytes +
        memory.instanceBytes +
        memory.fixedBufferBytes,
    );
    expect(memory.totalRenderTargetBytes).toBe(
      memory.visibleDepthBytes + memory.pickIdTargetBytes + memory.pickDepthBytes,
    );
  });
});
