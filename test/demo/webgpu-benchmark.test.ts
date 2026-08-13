import { describe, expect, it } from "vitest";
import {
  benchmarkCaseSpecs,
  createBenchmarkCase,
  estimateBenchmarkMemory,
} from "../../demo/benchmark/model";
import { createLazyBenchmarkModel } from "../../demo/workbench/model";

describe("WebGPU benchmark models", () => {
  it("keeps instanced and bounded unique-geometry cases distinct", () => {
    expect(benchmarkCaseSpecs(false).map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "instanced-2.10m", kind: "instancing-heavy" },
      { id: "unique-250k", kind: "unique-geometry" },
      { id: "unique-1m", kind: "unique-geometry" },
      { id: "many-parts-100", kind: "many-parts" },
      { id: "many-parts-1000", kind: "many-parts" },
      { id: "placements-10k", kind: "placement-heavy" },
      { id: "bodies-256", kind: "body-heavy" },
    ]);
    expect(benchmarkCaseSpecs(true).at(-1)?.id).toBe("unique-2m-local");
  });

  it("builds one reusable grid part at the requested bounded size", () => {
    const benchmarkCase = createBenchmarkCase({
      id: "tiny-test",
      name: "Tiny test",
      kind: "unique-geometry",
      gridCells: 2,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 0,
    });
    const part = benchmarkCase.scene.parts.get(1);
    expect(part?.geometry.positions).toHaveLength(27);
    expect(part?.geometry.indices).toHaveLength(24);
    expect(part?.geometry.elements).toEqual([
      { id: 1, primitiveStart: 0, primitiveCount: 2 },
      { id: 2, primitiveStart: 2, primitiveCount: 2 },
      { id: 3, primitiveStart: 4, primitiveCount: 2 },
      { id: 4, primitiveStart: 6, primitiveCount: 2 },
    ]);
  });

  it("keeps many-part and body-heavy cases structurally distinct", () => {
    const manyParts = createBenchmarkCase({
      id: "many-parts-test",
      name: "Many parts test",
      kind: "many-parts",
      gridCells: 2,
      partCount: 3,
      instanceCount: 3,
      bodyCount: 0,
    });
    const bodyHeavy = createBenchmarkCase({
      id: "bodies-test",
      name: "Bodies test",
      kind: "body-heavy",
      gridCells: 4,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 4,
    });
    expect(manyParts.scene.parts.size).toBe(3);
    expect(manyParts.scene.parts.get(1)).not.toBe(manyParts.scene.parts.get(2));
    expect(bodyHeavy.scene.parts.get(1)?.geometry.bodies).toHaveLength(4);
    expect(bodyHeavy.scene.parts.get(1)?.geometry.elements).toHaveLength(16);
    expect(
      bodyHeavy.scene.parts
        .get(1)
        ?.geometry.elements?.every((element) => element.bodyId !== undefined),
    ).toBe(true);
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

  it("keeps the matrix dimensions and scaling dimensions explicit", () => {
    const specs = benchmarkCaseSpecs(false);
    expect(specs.find((spec) => spec.id === "instanced-2.10m")).toMatchObject({
      gridCells: 128,
      partCount: 1,
      instanceCount: 64,
    });
    expect(specs.find((spec) => spec.id === "many-parts-1000")).toMatchObject({
      partCount: 1_000,
      instanceCount: 1_000,
    });
    expect(specs.find((spec) => spec.id === "placements-10k")).toMatchObject({
      partCount: 1,
      instanceCount: 10_000,
    });
    expect(specs.find((spec) => spec.id === "bodies-256")).toMatchObject({
      partCount: 1,
      bodyCount: 256,
    });
  });

  it("does not construct lazy visual cases during selector setup", async () => {
    const spec = benchmarkCaseSpecs(false).find((candidate) => candidate.id === "bodies-256");
    if (spec === undefined) throw new Error("body benchmark spec is missing");
    const lazy = createLazyBenchmarkModel(spec);
    expect(lazy.scene.parts.size).toBe(0);
    const loaded = await lazy.deferredLoad?.();
    expect(loaded?.scene.parts.size).toBe(1);
    expect(loaded?.scene.parts.get(1)?.geometry.bodies).toHaveLength(256);
  });
});
